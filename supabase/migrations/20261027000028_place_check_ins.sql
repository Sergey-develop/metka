-- Standalone tasks in Zavidovo (content plan, P1 «ещё 5–10 самостоятельных заданий», 2026-10-27):
--
--   * «Отметиться» at any active place of the area, once: the server checks the position (radius + up to
--     50 m of GPS error, as route steps) and gives the place's reward. Partners (cafés, restaurants) give
--     more and their check-ins are the confirmed visits of the partner economy (partner_visits()).
--   * «Голоса леса»: a collection with one sign per nature point, earned by checking in there
--     (artifacts.place_id).
--   * «След исследователя» (three different places) now counts check-ins as well as route steps.
--   * XP/coins through reward_ledger, source 'place' (source_id = md5 of the place id as a uuid).

alter table public.reward_ledger drop constraint if exists reward_ledger_source_type_check;
alter table public.reward_ledger add constraint reward_ledger_source_type_check
  check (source_type in ('building_discovery', 'quest', 'route_step', 'route', 'place'));

alter table public.area_places
  add column reward_xp    integer not null default 10 check (reward_xp between 0 and 10000),
  add column reward_coins integer not null default 0 check (reward_coins between 0 and 10000);
update public.area_places set reward_xp = 20, reward_coins = 10 where is_partner;

alter table public.artifacts add column place_id text references public.area_places (id) on delete set null;

create table public.player_places (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  place_id   text not null references public.area_places (id) on delete cascade,
  visited_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
create index player_places_place_idx on public.player_places (place_id, visited_at);
alter table public.player_places enable row level security;
revoke all on public.player_places from anon, authenticated;

insert into public.artifact_collections (id, area, title, ord) values ('zav-forest-voices', 'zavidovo', 'Голоса леса', 5);
insert into public.artifacts (id, collection_id, title, how, ord, place_id) values
  ('sign-trail', 'zav-forest-voices', 'Знак тропы', 'Отметься в начале «Муравьиной тропы»', 1, 'zav-ant-trail-start'),
  ('sign-anthill', 'zav-forest-voices', 'Знак муравейника', 'Отметься на «Муравьиной тропе»', 2, 'zav-ant-trail'),
  ('sign-pond', 'zav-forest-voices', 'Знак пруда', 'Отметься у пруда у «Ямской»', 3, 'zav-sloboda-lake'),
  ('sign-bay', 'zav-forest-voices', 'Знак бухты', 'Отметься у Главной бухты', 4, 'zav-bay'),
  ('sign-shore', 'zav-forest-voices', 'Знак берега', 'Отметься на пляже', 5, 'zav-beach');

-- ---------------------------------------------------------------------------
-- check_in_place
-- ---------------------------------------------------------------------------
-- {status: 'done' | 'already_done' | 'too_far', ...}: 'too_far' carries distanceM, 'done' the reward,
-- the artifacts earned and the new profile stats
create or replace function public.check_in_place(p_place_id text, p_lat double precision, p_lng double precision, p_accuracy_m real)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_place public.area_places%rowtype;
  v_distance real;
  v_artifacts text[] := '{}';
  v_profile jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_place from public.area_places where id = p_place_id and is_active;
  if not found then
    raise exception 'place_not_found' using errcode = 'P0001';
  end if;
  if v_place.location is null then
    raise exception 'place_unavailable' using errcode = 'P0001';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_accuracy_m is null or p_accuracy_m <= 0 or p_accuracy_m = 'NaN'::real then
    raise exception 'invalid_location' using errcode = '22023';
  end if;

  perform 1 from public.profiles where id = v_uid for update;
  if exists (select 1 from public.player_places where user_id = v_uid and place_id = p_place_id) then
    return jsonb_build_object('status', 'already_done');
  end if;

  v_distance := extensions.st_distance(
    v_place.location, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography)::real;
  if v_distance > v_place.radius_m + least(p_accuracy_m, 50) then
    return jsonb_build_object('status', 'too_far', 'distanceM', round(v_distance), 'radiusM', v_place.radius_m);
  end if;

  insert into public.player_places (user_id, place_id) values (v_uid, p_place_id);
  insert into public.reward_ledger (user_id, source_type, source_id, xp, coins)
  values (v_uid, 'place', md5('place:' || p_place_id)::uuid, v_place.reward_xp, v_place.reward_coins)
  on conflict (user_id, source_type, source_id) do nothing;

  select coalesce(array_agg(a.id), '{}') into v_artifacts
    from public.artifacts a where a.place_id = p_place_id and a.is_active;

  -- «След исследователя»: three different places, by check-ins and route steps together
  if (select count(*) from (
        select pp.place_id from public.player_places pp
          join public.area_places p on p.id = pp.place_id
         where pp.user_id = v_uid and p.area = v_place.area
        union
        select s.place_id from public.player_route_steps ps
          join public.route_steps s on s.id = ps.step_id
          join public.area_places p on p.id = s.place_id
         where ps.user_id = v_uid and p.area = v_place.area
      ) visited) >= 3
     and exists (select 1 from public.artifacts where id = 'explorer-trace' and is_active) then
    v_artifacts := v_artifacts || 'explorer-trace'::text;
  end if;

  with ins as (
    insert into public.player_artifacts (user_id, artifact_id)
    select v_uid, a from unnest(v_artifacts) as a
    on conflict do nothing
    returning artifact_id
  )
  select coalesce(array_agg(artifact_id), '{}') into v_artifacts from ins;

  update public.profiles
     set xp = xp + v_place.reward_xp,
         coins = coins + v_place.reward_coins,
         level = public.level_for_xp(xp + v_place.reward_xp)
   where id = v_uid
  returning jsonb_build_object('level', level, 'xp', xp, 'coins', coins, 'buildingsDiscovered', buildings_discovered)
    into v_profile;

  return jsonb_build_object(
    'status', 'done',
    'reward', jsonb_build_object('xp', v_place.reward_xp, 'coins', v_place.reward_coins),
    'artifacts', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title) order by a.id), '[]'::jsonb)
      from public.artifacts a where a.id = any (v_artifacts)
    ),
    'profile', v_profile
  );
end;
$$;

-- confirmed visits per partner (admins: the numbers to show a partner)
create or replace function public.partner_visits(p_area text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.app_admins where user_id = auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'placeId', p.id,
             'name', p.name,
             'visits', (select count(*) from public.player_places pp where pp.place_id = p.id),
             'last7Days', (select count(*) from public.player_places pp where pp.place_id = p.id and pp.visited_at > now() - interval '7 days')
           ) order by p.ord), '[]'::jsonb)
    from public.area_places p
    where p.area = p_area and p.is_partner and p.is_active
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- area_quests / complete_route_step see the check-ins
-- ---------------------------------------------------------------------------
create or replace function public._place_json(p public.area_places)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'zone', p.zone,
    'category', p.category,
    'name', p.name,
    'description', p.description,
    'idea', p.idea,
    'address', p.address,
    'lat', case when p.location is null then null else extensions.st_y(p.location::extensions.geometry) end,
    'lng', case when p.location is null then null else extensions.st_x(p.location::extensions.geometry) end,
    'radiusM', p.radius_m,
    'isPartner', p.is_partner,
    'needsCheck', p.needs_check,
    'tags', to_jsonb(p.tags),
    'openingHours', p.opening_hours,
    'phone', p.phone,
    'website', p.website,
    'rewardXp', p.reward_xp,
    'rewardCoins', p.reward_coins
  );
$$;
revoke execute on function public._place_json(public.area_places) from public, anon, authenticated;

-- area_quests of migration 027 plus `visits`: the player's check-ins
create or replace function public.area_quests(p_area text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'routes', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id,
               'slug', r.slug,
               'title', r.title,
               'questTitle', r.quest_title,
               'description', r.description,
               'duration', r.duration,
               'audience', r.audience,
               'categories', to_jsonb(r.categories),
               'note', r.note,
               'finalTitle', r.final_title,
               'finalText', r.final_text,
               'rewardXp', r.reward_xp,
               'rewardCoins', r.reward_coins,
               'artifact', (select jsonb_build_object('id', a.id, 'title', a.title) from public.artifacts a where a.id = r.artifact_id),
               'completedAt', (select pr.completed_at from public.player_routes pr where pr.user_id = v_uid and pr.route_id = r.id),
               'steps', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', s.id,
                          'slug', s.slug,
                          'ord', s.ord,
                          'title', s.title,
                          'task', s.task,
                          'kind', s.kind,
                          'question', s.question,
                          'options', s.options,
                          'safety', s.safety,
                          'rewardXp', s.reward_xp,
                          'artifact', (select jsonb_build_object('id', a.id, 'title', a.title) from public.artifacts a where a.id = s.artifact_id),
                          'place', (select public._place_json(p) from public.area_places p where p.id = s.place_id),
                          'doneAt', (select ps.done_at from public.player_route_steps ps where ps.user_id = v_uid and ps.step_id = s.id)
                        ) order by s.ord), '[]'::jsonb)
                 from public.route_steps s
                 where s.route_id = r.id
               )
             ) order by r.ord), '[]'::jsonb)
      from public.quest_routes r
      where r.area = p_area and r.is_active
    ),
    'places', (
      select coalesce(jsonb_agg(public._place_json(p) order by p.ord), '[]'::jsonb)
      from public.area_places p
      where p.area = p_area and p.is_active
    ),
    'visits', (
      select coalesce(jsonb_agg(jsonb_build_object('placeId', pp.place_id, 'visitedAt', pp.visited_at) order by pp.visited_at), '[]'::jsonb)
      from public.player_places pp
      join public.area_places p on p.id = pp.place_id
      where pp.user_id = v_uid and p.area = p_area
    ),
    'collections', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', c.id,
               'title', c.title,
               'items', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', a.id,
                          'title', a.title,
                          'how', a.how,
                          'earnedAt', (select pa.earned_at from public.player_artifacts pa where pa.user_id = v_uid and pa.artifact_id = a.id)
                        ) order by a.ord), '[]'::jsonb)
                 from public.artifacts a
                 where a.collection_id = c.id and a.is_active
               )
             ) order by c.ord), '[]'::jsonb)
      from public.artifact_collections c
      where c.area = p_area and c.is_active
    )
  );
end;
$$;

revoke execute on function public.check_in_place(text, double precision, double precision, real) from public, anon, authenticated;
grant execute on function public.check_in_place(text, double precision, double precision, real) to authenticated;
revoke execute on function public.partner_visits(text) from public, anon, authenticated;
grant execute on function public.partner_visits(text) to authenticated;
