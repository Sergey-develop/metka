-- Another player's profile (2026-10-23): the same screen as one's own profile, with their data.
-- Opened from the clan screen, so only clanmates may see it (the caller always sees themselves).
-- Shown: name, avatar, level, home district, streak/activity, streets, explored area and okrugs,
-- buildings found per district, achievements, best finds (catalog pictures only).
-- Not shown: coins, memories and their photos, favourites, scan photos, reward claims.
--
-- player_stats() and player_progress() keep their behaviour: their bodies move into
-- _player_stats(uid) / _player_progress(uid), which this function reuses for the other player.

create or replace function public._player_stats(p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_tz constant text := 'Europe/Moscow';
  -- days returned for the activity grid (12 weeks)
  c_window constant integer := 84;
  -- neighbourhood around a building's point that counts as "walked past it"
  c_near constant integer := 2;
  v_today date;
  v_home uuid;
  v_clan uuid;
  v_days date[];
  v_day date;
  v_streak integer := 0;
  v_streets jsonb;
  v_clan_json jsonb := null;
begin
  v_today := (now() at time zone c_tz)::date;

  select array_agg(d order by d desc) into v_days
  from (
    select (explored_at at time zone c_tz)::date as d from public.explored_cells where user_id = p_uid
    union
    select (discovered_at at time zone c_tz)::date from public.player_buildings where user_id = p_uid
    union
    select (created_at at time zone c_tz)::date from public.memories where user_id = p_uid
  ) s;
  v_days := coalesce(v_days, '{}'::date[]);

  v_day := case when v_today = any (v_days) then v_today else v_today - 1 end;
  while v_day = any (v_days) loop
    v_streak := v_streak + 1;
    v_day := v_day - 1;
  end loop;

  select home_district_id into v_home from public.profiles where id = p_uid;

  with scope as (
    select nullif(btrim(coalesce(b.tags ->> 'addr:street', b.tags ->> 'addr:place')), '') as street,
           floor((extensions.st_y(b.centroid) + 90) / 0.0001)::integer as cy,
           floor((extensions.st_x(b.centroid) + 180) / 0.00018)::integer as cx
    from public.osm_buildings b
    where v_home is null
       or exists (
         select 1 from public.districts d
         where d.id = v_home and extensions.st_covers(d.boundary, b.centroid::extensions.geography)
       )
  ),
  named as (
    select street,
           exists (
             select 1 from public.explored_cells c
             where c.user_id = p_uid
               and c.cell_y between cy - c_near and cy + c_near
               and c.cell_x between cx - c_near and cx + c_near
           ) as walked
    from scope
    where street is not null
  )
  select jsonb_build_object(
    'visited', count(distinct street) filter (where walked),
    'total', count(distinct street),
    'scope', case when v_home is null then 'all' else 'home' end
  ) into v_streets
  from named;

  select clan_id into v_clan from public.clan_members where user_id = p_uid;
  if v_clan is not null then
    select jsonb_build_object(
      'level', public.level_for_xp(least(sum(p.xp), 2147483647)::integer),
      'discoveries', (
        select count(*) from public.player_buildings pb
        join public.clan_members m2 on m2.user_id = pb.user_id
        where m2.clan_id = v_clan
      )
    ) into v_clan_json
    from public.clan_members m
    join public.profiles p on p.id = m.user_id
    where m.clan_id = v_clan;
  end if;

  return jsonb_build_object(
    'today', v_today,
    'streakDays', v_streak,
    'activeDays', (
      select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
      from unnest(v_days) d
      where d > v_today - c_window
    ),
    'streets', v_streets,
    'clan', v_clan_json
  );
end;
$$;

create or replace function public._player_progress(p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_district_min_cells constant integer := 130;
  v_result jsonb;
begin
  with cell_districts as (
    select d.id as district_id, count(*) as cells
    from public.explored_cells c
    join public.districts d
      on extensions.st_covers(d.boundary,
           extensions.st_setsrid(extensions.st_makepoint(
             (c.cell_x + 0.5) * 0.00018 - 180, (c.cell_y + 0.5) * 0.0001 - 90), 4326)::extensions.geography)
    where c.user_id = p_uid
    group by d.id
  )
  select jsonb_build_object(
    'exploredCells', (select count(*) from public.explored_cells where user_id = p_uid),
    'exploredDistricts', (select count(*) from cell_districts where cells >= c_district_min_cells),
    'districtMinCells', c_district_min_cells,
    'unlockedBuildings', (select count(*) from public.player_buildings where user_id = p_uid),
    'memories', (select count(*) from public.memories where user_id = p_uid),
    'favoritePlaces', (select count(*) from public.memories where user_id = p_uid and is_favorite)
  ) into v_result;
  return v_result;
end;
$$;

revoke execute on function public._player_stats(uuid) from public, anon, authenticated;
revoke execute on function public._player_progress(uuid) from public, anon, authenticated;

create or replace function public.player_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return public._player_stats(auth.uid());
end;
$$;

create or replace function public.player_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return public._player_progress(auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- player_public_profile: the other player's profile screen
-- ---------------------------------------------------------------------------
create or replace function public.player_public_profile(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_best_finds constant integer := 8;
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_progress jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  -- clanmates only; an unknown id gets the same answer, so ids cannot be probed
  if p_user_id is distinct from v_uid and not exists (
    select 1 from public.clan_members mine
    join public.clan_members theirs on theirs.clan_id = mine.clan_id
    where mine.user_id = v_uid and theirs.user_id = p_user_id
  ) then
    raise exception 'profile_hidden' using errcode = 'P0001';
  end if;
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    raise exception 'profile_hidden' using errcode = 'P0001';
  end if;

  -- memories and favourites are private
  v_progress := public._player_progress(p_user_id) - 'memories' - 'favoritePlaces';

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'username', v_profile.username,
      'avatarPath', v_profile.avatar_path,
      'avatarKey', v_profile.avatar_key,
      'level', v_profile.level,
      'xp', v_profile.xp,
      'buildingsDiscovered', v_profile.buildings_discovered,
      'homeDistrictId', v_profile.home_district_id
    ),
    'stats', public._player_stats(p_user_id),
    'progress', v_progress,
    -- buildings found per district, for «открыл X% Москвы» and the home district's places
    'discoveredByDistrict', (
      select coalesce(jsonb_object_agg(district_id, n), '{}'::jsonb)
      from (
        select b.district_id, count(*) as n
        from public.player_buildings pb
        join public.buildings b on b.id = pb.building_id and b.is_active
        where pb.user_id = p_user_id and b.district_id is not null
        group by b.district_id
      ) s
    ),
    'achievements', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', q.id,
               'slug', q.slug,
               'title', q.title,
               'description', q.description,
               'kind', q.kind,
               'target', q.target,
               'progress', coalesce(pq.progress, 0),
               'completedAt', pq.completed_at
             ) order by q.target), '[]'::jsonb)
      from public.quests q
      left join public.player_quests pq on pq.quest_id = q.id and pq.user_id = p_user_id
      where q.is_active
    ),
    'bestFinds', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'buildingId', f.id, 'name', f.name, 'rarity', f.rarity, 'imageUrl', f.image_url
             ) order by f.rank, f.discovered_at desc), '[]'::jsonb)
      from (
        select b.id, b.name, b.rarity, b.image_url, pb.discovered_at,
               case b.rarity when 'legendary' then 0 when 'epic' then 1 when 'rare' then 2 else 3 end as rank
        from public.player_buildings pb
        join public.buildings b on b.id = pb.building_id and b.is_active
        where pb.user_id = p_user_id
        order by rank, pb.discovered_at desc
        limit c_best_finds
      ) f
    )
  );
end;
$$;

revoke execute on function public.player_public_profile(uuid) from public, anon, authenticated;
grant execute on function public.player_public_profile(uuid) to authenticated;
