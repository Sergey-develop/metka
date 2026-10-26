-- Profile statistics that were stubs on the profile screen (2026-10-21):
-- active days / streak, visited streets, clan level and discoveries.
-- Every number is counted on the server from existing tables; nothing is stored or trusted from the client.
--
-- Definitions:
--   * active day  — a Moscow calendar day with any of: explored cell, discovered building, memory created.
--   * streak      — consecutive active days ending today (or yesterday, while today is still open).
--   * street      — OSM addr:street (or addr:place) of a building; visited when the player explored a cell
--                   within ±2 cells (~22 m) of the building's point. Scope: home district, else all imported.
--   * clan level  — level_for_xp of the members' total XP; discoveries — buildings opened by the members.

create or replace function public.player_stats()
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
  v_uid uuid := auth.uid();
  v_today date;
  v_home uuid;
  v_clan uuid;
  v_days date[];
  v_day date;
  v_streak integer := 0;
  v_streets jsonb;
  v_clan_json jsonb := null;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  v_today := (now() at time zone c_tz)::date;

  select array_agg(d order by d desc) into v_days
  from (
    select (explored_at at time zone c_tz)::date as d from public.explored_cells where user_id = v_uid
    union
    select (discovered_at at time zone c_tz)::date from public.player_buildings where user_id = v_uid
    union
    select (created_at at time zone c_tz)::date from public.memories where user_id = v_uid
  ) s;
  v_days := coalesce(v_days, '{}'::date[]);

  v_day := case when v_today = any (v_days) then v_today else v_today - 1 end;
  while v_day = any (v_days) loop
    v_streak := v_streak + 1;
    v_day := v_day - 1;
  end loop;

  select home_district_id into v_home from public.profiles where id = v_uid;

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
             where c.user_id = v_uid
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

  select clan_id into v_clan from public.clan_members where user_id = v_uid;
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

revoke execute on function public.player_stats() from public, anon, authenticated;
grant execute on function public.player_stats() to authenticated;
