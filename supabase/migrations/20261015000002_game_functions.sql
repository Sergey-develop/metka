-- METKA game functions. All game-critical state changes (scan acceptance,
-- collection, XP, coins, influence, quests, clans) happen here, inside a single
-- transaction per call. Functions use an empty search_path and fully
-- qualified names.

-- ---------------------------------------------------------------------------
-- progression formula (mirrored for display in src/features/progression/levels.ts;
-- tests/db/progression.test.ts checks both implementations agree)
-- total XP required to reach level L = 50 * L * (L - 1)
-- ---------------------------------------------------------------------------
create or replace function public.level_for_xp(p_xp integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_level integer;
begin
  if p_xp is null or p_xp <= 0 then
    return 1;
  end if;
  v_level := floor((1 + sqrt(1 + 0.08 * p_xp::double precision)) / 2)::integer;
  -- guard against floating point error at exact boundaries
  while 50 * (v_level + 1) * v_level <= p_xp loop
    v_level := v_level + 1;
  end loop;
  while v_level > 1 and 50 * v_level * (v_level - 1) > p_xp loop
    v_level := v_level - 1;
  end loop;
  return v_level;
end;
$$;

-- ---------------------------------------------------------------------------
-- profile bootstrap on sign-up
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested text := btrim(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_fallback  text := 'player_' || substr(replace(new.id::text, '-', ''), 1, 10);
  v_username  text;
begin
  if v_requested ~ '^[A-Za-z0-9_А-Яа-яЁё]{3,24}$'
     and not exists (select 1 from public.profiles where lower(username) = lower(v_requested)) then
    v_username := v_requested;
  else
    v_username := v_fallback;
  end if;

  insert into public.profiles (id, username) values (new.id, v_username);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- map queries (security invoker: RLS applies)
-- ---------------------------------------------------------------------------
create or replace function public.buildings_in_bbox(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision,
  p_limit integer default 500
)
returns table (
  id uuid,
  slug text,
  name text,
  description text,
  address text,
  district_id uuid,
  lat double precision,
  lng double precision,
  scan_radius_m integer,
  rarity text,
  reward_xp integer,
  reward_coins integer,
  reward_influence integer,
  image_url text,
  is_dev_seed boolean,
  discovered_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_min_lng is null or p_min_lat is null or p_max_lng is null or p_max_lat is null
     or p_min_lng >= p_max_lng or p_min_lat >= p_max_lat
     or p_min_lng < -180 or p_max_lng > 180 or p_min_lat < -90 or p_max_lat > 90 then
    raise exception 'invalid_bbox' using errcode = '22023';
  end if;
  if (p_max_lng - p_min_lng) > 1.0 or (p_max_lat - p_min_lat) > 1.0 then
    raise exception 'bbox_too_large' using errcode = '22023';
  end if;

  return query
  select b.id, b.slug, b.name, b.description, b.address, b.district_id,
         extensions.st_y(b.location::extensions.geometry),
         extensions.st_x(b.location::extensions.geometry),
         b.scan_radius_m, b.rarity, b.reward_xp, b.reward_coins, b.reward_influence,
         b.image_url, b.is_dev_seed, pb.discovered_at
  from public.buildings b
  left join public.player_buildings pb
    on pb.building_id = b.id and pb.user_id = (select auth.uid())
  where b.is_active
    and b.location operator(extensions.&&) extensions.st_makeenvelope(
          p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::extensions.geography
  order by b.id
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
end;
$$;

create or replace function public.districts_overview()
returns table (
  id uuid,
  slug text,
  name text,
  short_name text,
  boundary jsonb,
  total_buildings integer,
  discovered_buildings integer,
  my_influence integer
)
language sql
stable
set search_path = ''
as $$
  select d.id, d.slug, d.name, d.short_name,
         extensions.st_asgeojson(d.boundary, 6)::jsonb,
         (select count(*)::integer from public.buildings b
           where b.district_id = d.id and b.is_active),
         (select count(*)::integer from public.player_buildings pb
            join public.buildings b on b.id = pb.building_id
           where b.district_id = d.id and pb.user_id = (select auth.uid())),
         coalesce((select pi.points from public.player_influence pi
                    where pi.district_id = d.id and pi.user_id = (select auth.uid())), 0)
  from public.districts d
  order by d.name;
$$;

-- ---------------------------------------------------------------------------
-- recognition matching (server-side; reference embeddings never leave the DB)
-- ---------------------------------------------------------------------------
create or replace function public._validated_embedding(
  p_embedding real[],
  p_model public.recognition_models
)
returns extensions.vector
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_embedding is null
     or array_ndims(p_embedding) <> 1
     or array_length(p_embedding, 1) <> p_model.embedding_dim then
    return null;
  end if;
  if exists (
    select 1 from unnest(p_embedding) as x
    where x is null or x = 'NaN'::real or x = 'Infinity'::real or x = '-Infinity'::real
  ) then
    return null;
  end if;
  if (select sum(x * x) from unnest(p_embedding) as x) < 1e-12 then
    return null;
  end if;
  return p_embedding::extensions.vector;
end;
$$;

-- Ranks catalog buildings near a point by similarity to the scan embedding.
-- Used by the client to show candidates; never used to grant rewards.
create or replace function public.match_building_candidates(
  p_embedding real[],
  p_model_version text,
  p_lat double precision,
  p_lng double precision,
  p_limit integer default 5
)
returns table (building_id uuid, name text, score real, distance_m real)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_model public.recognition_models%rowtype;
  v_embedding extensions.vector;
  v_point extensions.geography;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid_location' using errcode = '22023';
  end if;
  select * into v_model from public.recognition_models where version = p_model_version and is_active;
  if not found then
    raise exception 'recognition_unavailable' using errcode = 'P0001';
  end if;
  v_embedding := public._validated_embedding(p_embedding, v_model);
  if v_embedding is null then
    raise exception 'invalid_embedding' using errcode = '22023';
  end if;
  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;

  return query
  select r.building_id, b.name,
         max(1 - (r.embedding operator(extensions.<=>) v_embedding))::real as score,
         extensions.st_distance(b.location, v_point)::real
  from public.building_reference_embeddings r
  join public.buildings b on b.id = r.building_id
  where r.model_version = v_model.version
    and b.is_active
    and extensions.st_dwithin(b.location, v_point, 300)
  group by r.building_id, b.name, b.location
  order by score desc
  limit least(greatest(coalesce(p_limit, 5), 1), 10);
end;
$$;

-- ---------------------------------------------------------------------------
-- quests progress (internal)
-- ---------------------------------------------------------------------------
create or replace function public._advance_quests(p_user_id uuid, p_building public.buildings)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quests%rowtype;
  v_progress integer;
  v_completed jsonb := '[]'::jsonb;
begin
  for q in
    select * from public.quests
    where is_active
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at > now())
      and (kind = 'discover_count'
           or (kind = 'discover_in_district' and district_id = p_building.district_id)
           or (kind = 'discover_rarity' and rarity = p_building.rarity))
  loop
    insert into public.player_quests as pq (user_id, quest_id, progress)
    values (p_user_id, q.id, 1)
    on conflict (user_id, quest_id) do update
      set progress = least(pq.progress + 1, q.target)
      where pq.completed_at is null
    returning pq.progress into v_progress;

    if v_progress is not null and v_progress >= q.target then
      update public.player_quests
         set completed_at = now()
       where user_id = p_user_id and quest_id = q.id and completed_at is null;
      if found then
        v_completed := v_completed || jsonb_build_object('questId', q.id, 'slug', q.slug, 'title', q.title);
      end if;
    end if;
  end loop;
  return v_completed;
end;
$$;

-- ---------------------------------------------------------------------------
-- scan submission: the only path to discover a building and earn its reward
-- ---------------------------------------------------------------------------
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

  if v_reason is null then
    select * into v_model from public.recognition_models where version = p_model_version and is_active;
    if not found then
      v_reason := 'recognition_unavailable';
    end if;
  end if;

  if v_reason is null then
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
  if v_reason is null then
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
         model_version = v_model.version,
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

-- ---------------------------------------------------------------------------
-- quest reward claim
-- ---------------------------------------------------------------------------
create or replace function public.claim_quest_reward(p_quest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_quest public.quests%rowtype;
  v_completed_at timestamptz;
  v_reward_id uuid;
  v_profile jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select q.* into v_quest from public.quests q where q.id = p_quest_id;
  if not found then
    raise exception 'quest_not_found' using errcode = 'P0001';
  end if;

  select pq.completed_at into v_completed_at
    from public.player_quests pq
   where pq.user_id = v_uid and pq.quest_id = p_quest_id
   for update;
  if v_completed_at is null then
    raise exception 'quest_not_completed' using errcode = 'P0001';
  end if;

  insert into public.reward_ledger (user_id, source_type, source_id, xp, coins)
  values (v_uid, 'quest', p_quest_id, v_quest.reward_xp, v_quest.reward_coins)
  on conflict (user_id, source_type, source_id) do nothing
  returning id into v_reward_id;

  if v_reward_id is null then
    return jsonb_build_object('status', 'already_claimed', 'questId', p_quest_id);
  end if;

  update public.player_quests set claimed_at = now()
   where user_id = v_uid and quest_id = p_quest_id;

  update public.profiles
     set xp = xp + v_quest.reward_xp,
         coins = coins + v_quest.reward_coins,
         level = public.level_for_xp(xp + v_quest.reward_xp)
   where id = v_uid
  returning jsonb_build_object('level', level, 'xp', xp, 'coins', coins,
                               'buildingsDiscovered', buildings_discovered)
    into v_profile;

  return jsonb_build_object(
    'status', 'claimed',
    'questId', p_quest_id,
    'reward', jsonb_build_object('xp', v_quest.reward_xp, 'coins', v_quest.reward_coins),
    'profile', v_profile);
end;
$$;

-- ---------------------------------------------------------------------------
-- clans
-- ---------------------------------------------------------------------------
create or replace function public.create_clan(p_name text, p_tag text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_clan_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_tag text := upper(btrim(coalesce(p_tag, '')));
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.clan_members where user_id = v_uid) then
    raise exception 'already_in_clan' using errcode = 'P0001';
  end if;
  if char_length(v_name) not between 3 and 32 or v_tag !~ '^[A-Z0-9А-ЯЁ]{2,5}$' then
    raise exception 'invalid_clan' using errcode = '22023';
  end if;
  if exists (select 1 from public.clans where lower(name) = lower(v_name) or tag = v_tag) then
    raise exception 'clan_taken' using errcode = 'P0001';
  end if;

  insert into public.clans (name, tag, owner_id) values (v_name, v_tag, v_uid)
  returning id into v_clan_id;
  insert into public.clan_members (clan_id, user_id, role) values (v_clan_id, v_uid, 'owner');
  return v_clan_id;
exception
  when unique_violation then
    raise exception 'clan_taken' using errcode = 'P0001';
end;
$$;

create or replace function public.join_clan(p_clan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_members constant integer := 50;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  perform 1 from public.clans where id = p_clan_id for update;
  if not found then
    raise exception 'clan_not_found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.clan_members where user_id = v_uid) then
    raise exception 'already_in_clan' using errcode = 'P0001';
  end if;
  if (select count(*) from public.clan_members where clan_id = p_clan_id) >= c_max_members then
    raise exception 'clan_full' using errcode = 'P0001';
  end if;
  insert into public.clan_members (clan_id, user_id, role) values (p_clan_id, v_uid, 'member');
exception
  when unique_violation then
    raise exception 'already_in_clan' using errcode = 'P0001';
end;
$$;

create or replace function public.leave_clan()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.clan_members%rowtype;
  v_successor uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_member from public.clan_members where user_id = v_uid for update;
  if not found then
    raise exception 'not_in_clan' using errcode = 'P0001';
  end if;

  perform 1 from public.clans where id = v_member.clan_id for update;
  delete from public.clan_members where user_id = v_uid;

  if v_member.role = 'owner' then
    select user_id into v_successor
      from public.clan_members
     where clan_id = v_member.clan_id
     order by joined_at, user_id
     limit 1;
    if v_successor is null then
      delete from public.clans where id = v_member.clan_id;
    else
      update public.clan_members set role = 'owner'
       where clan_id = v_member.clan_id and user_id = v_successor;
      update public.clans set owner_id = v_successor where id = v_member.clan_id;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- leaderboards (security invoker; underlying tables are public game state)
-- ---------------------------------------------------------------------------
create or replace function public.district_leaderboard(p_district_id uuid, p_limit integer default 20)
returns table (user_id uuid, username text, level integer, points integer, rank bigint)
language sql
stable
set search_path = ''
as $$
  select p.id, p.username, p.level, pi.points,
         rank() over (order by pi.points desc)
  from public.player_influence pi
  join public.profiles p on p.id = pi.user_id
  where pi.district_id = p_district_id and pi.points > 0
  order by pi.points desc, p.username
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

create or replace function public.clan_leaderboard(p_district_id uuid default null, p_limit integer default 20)
returns table (clan_id uuid, name text, tag text, members integer, points bigint, rank bigint)
language sql
stable
set search_path = ''
as $$
  select c.id, c.name, c.tag,
         (select count(*)::integer from public.clan_members m2 where m2.clan_id = c.id),
         coalesce(sum(pi.points), 0)::bigint as points,
         rank() over (order by coalesce(sum(pi.points), 0) desc)
  from public.clans c
  join public.clan_members m on m.clan_id = c.id
  left join public.player_influence pi
    on pi.user_id = m.user_id
   and (p_district_id is null or pi.district_id = p_district_id)
  group by c.id, c.name, c.tag
  order by points desc, c.name
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

-- ---------------------------------------------------------------------------
-- execute privileges: deny by default, allow the public API explicitly
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.level_for_xp(integer) to authenticated;
grant execute on function public.buildings_in_bbox(double precision, double precision, double precision, double precision, integer) to authenticated;
grant execute on function public.districts_overview() to authenticated;
grant execute on function public.match_building_candidates(real[], text, double precision, double precision, integer) to authenticated;
grant execute on function public.submit_building_scan(uuid, uuid, double precision, double precision, real, text, real[], text, jsonb) to authenticated;
grant execute on function public.claim_quest_reward(uuid) to authenticated;
grant execute on function public.create_clan(text, text) to authenticated;
grant execute on function public.join_clan(uuid) to authenticated;
grant execute on function public.leave_clan() to authenticated;
grant execute on function public.district_leaderboard(uuid, integer) to authenticated;
grant execute on function public.clan_leaderboard(uuid, integer) to authenticated;
