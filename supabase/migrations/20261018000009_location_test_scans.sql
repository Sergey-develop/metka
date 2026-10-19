-- TEST MODE: location-only scanning for listed tester accounts (no recognition model yet, ADR-001).
-- A tester standing within the building's scan radius (GPS accuracy ≤ 35 m) who sends a photo hash
-- gets the building discovered without image recognition. This proves presence, not what was
-- photographed, so it is limited to accounts added by hand:
--   insert into public.location_scan_testers (user_id) values ('<auth user id>');
-- Such scans are stored with model_version = 'location-test-v1' and can be audited/removed.
-- Everything else (idempotency, rate limit, catalog, distance, duplicate photo, rewards, quests,
-- influence) is the unchanged logic of submit_building_scan from 20261015000002.

create table public.location_scan_testers (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.location_scan_testers enable row level security;
revoke all on public.location_scan_testers from anon, authenticated;

create or replace function public.is_location_scan_tester()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.location_scan_testers where user_id = (select auth.uid()))
$$;
revoke execute on function public.is_location_scan_tester() from public, anon, authenticated;
grant execute on function public.is_location_scan_tester() to authenticated;

create or replace function public.submit_building_scan(
  p_client_request_id uuid,
  p_building_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m real,
  p_model_version text,
  p_embedding real[],
  p_image_sha256 text default null,
  p_quality jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_rate_limit_per_minute constant integer := 10;
  c_max_accuracy_m        constant real    := 100;
  c_accuracy_allowance_m  constant real    := 30;
  c_neighbour_radius_m    constant real    := 300;
  -- TEST ONLY (migration 009): location-only scans without recognition, for listed testers
  c_location_test_model   constant text    := 'location-test-v1';
  c_location_test_accuracy constant real   := 35;

  v_uid        uuid := auth.uid();
  v_scan_id    uuid;
  v_existing   jsonb;
  v_reason     text;
  v_status     text;
  v_building   public.buildings%rowtype;
  v_model      public.recognition_models%rowtype;
  v_embedding  extensions.vector;
  v_point      extensions.geography;
  v_distance   real;
  v_target     real;
  v_other      real;
  v_other_id   uuid;
  v_pb_id      uuid;
  v_reward_id  uuid;
  v_reward     jsonb := null;
  v_profile    jsonb := null;
  v_quests     jsonb := '[]'::jsonb;
  v_result     jsonb;
  -- coalesce: a NULL model version must not turn the recognition checks below into NULL (= skipped)
  v_location_test boolean := coalesce(p_model_version = 'location-test-v1', false);
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_client_request_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile_missing' using errcode = 'P0001';
  end if;

  -- idempotency: the unique (user_id, client_request_id) row is the lock
  insert into public.building_scans (user_id, client_request_id)
  values (v_uid, p_client_request_id)
  on conflict (user_id, client_request_id) do nothing
  returning id into v_scan_id;

  if v_scan_id is null then
    select result into v_existing
      from public.building_scans
     where user_id = v_uid and client_request_id = p_client_request_id;
    return coalesce(v_existing, '{}'::jsonb) || jsonb_build_object('duplicate', true);
  end if;

  -- rate limit
  if (select count(*) from public.building_scans
       where user_id = v_uid and id <> v_scan_id
         and created_at > now() - interval '1 minute') >= c_rate_limit_per_minute then
    v_reason := 'rate_limited';
  end if;

  -- location sanity
  if v_reason is null and (
       p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
       or p_accuracy_m is null or p_accuracy_m <= 0 or p_accuracy_m = 'NaN'::real) then
    v_reason := 'invalid_location';
  end if;

  -- building must exist in the active catalog (never trust a client id blindly)
  if v_reason is null then
    select * into v_building from public.buildings where id = p_building_id and is_active;
    if not found then
      v_reason := 'building_not_found';
    end if;
  end if;

  if v_reason is null and p_accuracy_m > c_max_accuracy_m then
    v_reason := 'location_inaccurate';
  end if;

  if v_reason is null then
    v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
    v_distance := extensions.st_distance(v_building.location, v_point)::real;
    if v_distance > v_building.scan_radius_m + least(p_accuracy_m, c_accuracy_allowance_m) then
      v_reason := 'too_far';
    end if;
  end if;

  -- TEST ONLY: no recognition, but a listed tester, a tighter GPS fix and a photo hash are required.
  -- Proves presence near the building, not what was photographed — never enable for players.
  if v_reason is null and v_location_test then
    if not exists (select 1 from public.location_scan_testers where user_id = v_uid) then
      v_reason := 'recognition_unavailable';
    elsif p_accuracy_m > c_location_test_accuracy then
      v_reason := 'location_inaccurate';
    elsif p_image_sha256 is null then
      v_reason := 'invalid_request';
    end if;
  end if;

  if v_reason is null and not v_location_test then
    select * into v_model from public.recognition_models where version = p_model_version and is_active;
    if not found then
      v_reason := 'recognition_unavailable';
    end if;
  end if;

  if v_reason is null and not v_location_test then
    v_embedding := public._validated_embedding(p_embedding, v_model);
    if v_embedding is null then
      v_reason := 'invalid_embedding';
    end if;
  end if;

  if v_reason is null and p_image_sha256 is not null then
    if p_image_sha256 !~ '^[0-9a-f]{64}$' then
      v_reason := 'invalid_request';
    elsif exists (select 1 from public.building_scans
                   where image_sha256 = p_image_sha256 and status = 'accepted') then
      v_reason := 'duplicate_image';
    end if;
  end if;

  -- server-side recognition decision: target vs neighbouring buildings
  if v_reason is null and not v_location_test then
    with scores as (
      select r.building_id,
             max(1 - (r.embedding operator(extensions.<=>) v_embedding))::real as score
      from public.building_reference_embeddings r
      join public.buildings b on b.id = r.building_id
      where r.model_version = v_model.version
        and b.is_active
        and extensions.st_dwithin(b.location, v_building.location, c_neighbour_radius_m)
      group by r.building_id
    )
    select max(score) filter (where building_id = v_building.id),
           max(score) filter (where building_id <> v_building.id),
           (array_agg(building_id order by score desc) filter (where building_id <> v_building.id))[1]
      into v_target, v_other, v_other_id
      from scores;

    if v_target is null then
      v_reason := 'recognition_unavailable';
    elsif v_target > v_model.max_plausible_score then
      v_reason := 'suspicious_embedding';
    elsif v_other is not null and v_other > v_target and v_other >= v_model.score_threshold then
      v_reason := 'other_building';
    elsif v_target < v_model.score_threshold then
      v_reason := 'not_recognized';
    elsif v_target - coalesce(v_other, 0) < v_model.margin_threshold then
      v_reason := 'ambiguous';
    end if;
  end if;

  if v_reason is not null then
    v_status := 'rejected';
  else
    insert into public.player_buildings (user_id, building_id, scan_id)
    values (v_uid, v_building.id, v_scan_id)
    on conflict (user_id, building_id) do nothing
    returning id into v_pb_id;

    if v_pb_id is null then
      v_status := 'already_discovered';
    else
      v_status := 'accepted';
      insert into public.reward_ledger (user_id, source_type, source_id, xp, coins, influence, district_id)
      values (v_uid, 'building_discovery', v_building.id,
              v_building.reward_xp, v_building.reward_coins,
              case when v_building.district_id is null then 0 else v_building.reward_influence end,
              v_building.district_id)
      on conflict (user_id, source_type, source_id) do nothing
      returning id into v_reward_id;

      if v_reward_id is not null then
        update public.profiles
           set xp = xp + v_building.reward_xp,
               coins = coins + v_building.reward_coins,
               level = public.level_for_xp(xp + v_building.reward_xp),
               buildings_discovered = buildings_discovered + 1
         where id = v_uid;

        if v_building.district_id is not null and v_building.reward_influence > 0 then
          insert into public.player_influence as pi (user_id, district_id, points)
          values (v_uid, v_building.district_id, v_building.reward_influence)
          on conflict (user_id, district_id) do update set points = pi.points + excluded.points;
        end if;

        v_quests := public._advance_quests(v_uid, v_building);
        v_reward := jsonb_build_object(
          'xp', v_building.reward_xp,
          'coins', v_building.reward_coins,
          'influence', case when v_building.district_id is null then 0 else v_building.reward_influence end);
      end if;
    end if;
  end if;

  select jsonb_build_object('level', level, 'xp', xp, 'coins', coins,
                            'buildingsDiscovered', buildings_discovered)
    into v_profile from public.profiles where id = v_uid;

  v_result := jsonb_build_object(
    'scanId', v_scan_id,
    'status', v_status,
    'reason', v_reason,
    'buildingId', v_building.id,
    'distanceM', v_distance,
    'recognition', jsonb_build_object(
      'targetScore', v_target,
      'bestOtherScore', v_other,
      'bestOtherBuildingId', v_other_id),
    'reward', v_reward,
    'completedQuests', v_quests,
    'profile', v_profile,
    'duplicate', false);

  update public.building_scans
     set building_id = v_building.id,
         status = v_status,
         reject_reason = v_reason,
         player_location = v_point,
         accuracy_m = p_accuracy_m,
         distance_m = v_distance,
         model_version = case when v_location_test then c_location_test_model else v_model.version end,
         target_score = v_target,
         best_other_score = v_other,
         best_other_building_id = v_other_id,
         image_sha256 = case when v_reason = 'invalid_request' then null else p_image_sha256 end,
         quality = p_quality,
         result = v_result
   where id = v_scan_id;

  return v_result;
end;
$$;

-- create or replace keeps the existing grant (authenticated) from 20261015000002
