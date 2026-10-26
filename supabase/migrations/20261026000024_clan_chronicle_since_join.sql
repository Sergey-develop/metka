-- Clan chronicle (migration 017): a member's discoveries appear only from the moment they joined the
-- clan — what they found before (alone or in another clan) is not the clan's history.
-- clan_page() is the body of 017 with that one condition added.

create or replace function public.clan_page()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_tz constant text := 'Europe/Moscow';
  -- weekly goal target per member (tunable game balance)
  c_goal_per_member constant integer := 200;
  -- same limit as join_clan()
  c_max_members constant integer := 50;
  c_chronicle constant integer := 5;
  v_uid uuid := auth.uid();
  v_clan public.clans%rowtype;
  v_today date;
  v_week_start timestamptz;
  v_home public.districts%rowtype;
  v_members jsonb;
  v_count integer;
  v_goal_progress integer;
  v_owned jsonb;
  v_metrics jsonb;
  v_chronicle jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select c.* into v_clan
  from public.clans c
  join public.clan_members m on m.clan_id = c.id
  where m.user_id = v_uid;
  if not found then
    return null;
  end if;

  v_today := (now() at time zone c_tz)::date;
  v_week_start := (date_trunc('week', v_today::timestamp)) at time zone c_tz;

  select d.* into v_home
  from public.profiles p
  join public.districts d on d.id = p.home_district_id
  where p.id = v_clan.owner_id;

  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'userId', m.user_id,
           'username', p.username,
           'level', p.level,
           'role', m.role,
           'avatarPath', p.avatar_path,
           'avatarKey', p.avatar_key,
           'weekCells', (
             select count(*) from public.explored_cells c
             where c.user_id = m.user_id and c.explored_at >= v_week_start
           )
         ) order by m.joined_at), '[]'::jsonb)
    into v_count, v_members
  from public.clan_members m
  join public.profiles p on p.id = m.user_id
  where m.clan_id = v_clan.id;

  select count(*)::integer into v_goal_progress
  from public.explored_cells c
  join public.clan_members m on m.user_id = c.user_id and m.clan_id = v_clan.id
  where c.explored_at >= v_week_start
    and (
      v_home.id is null
      or extensions.st_covers(v_home.boundary,
           extensions.st_setsrid(extensions.st_makepoint(
             (c.cell_x + 0.5) * 0.00018 - 180, (c.cell_y + 0.5) * 0.0001 - 90), 4326)::extensions.geography)
    );

  with clan_points as (
    select m.clan_id, pi.district_id, sum(pi.points) as points
    from public.player_influence pi
    join public.clan_members m on m.user_id = pi.user_id
    group by m.clan_id, pi.district_id
  )
  select coalesce(jsonb_agg(mine.district_id order by mine.district_id), '[]'::jsonb) into v_owned
  from clan_points mine
  where mine.clan_id = v_clan.id
    and mine.points > 0
    and not exists (
      select 1 from clan_points other
      where other.district_id = mine.district_id
        and other.clan_id <> mine.clan_id
        and other.points >= mine.points
    );

  select jsonb_build_object(
    'level', public.level_for_xp(least(coalesce(sum(p.xp), 0), 2147483647)::integer),
    'exploredCells', (
      select count(*) from public.explored_cells c
      join public.clan_members m2 on m2.user_id = c.user_id
      where m2.clan_id = v_clan.id
    ),
    'discoveries', (
      select count(*) from public.player_buildings pb
      join public.clan_members m2 on m2.user_id = pb.user_id
      where m2.clan_id = v_clan.id
    )
  ) into v_metrics
  from public.clan_members m
  join public.profiles p on p.id = m.user_id
  where m.clan_id = v_clan.id;

  select coalesce(jsonb_agg(e order by (e ->> 'at')::timestamptz desc), '[]'::jsonb) into v_chronicle
  from (
    select e from (
      select jsonb_build_object(
               'kind', 'discovery',
               'at', pb.discovered_at,
               'username', p.username,
               'buildingName', b.name,
               'rarity', b.rarity
             ) as e,
             pb.discovered_at as at
      from public.player_buildings pb
      join public.clan_members m on m.user_id = pb.user_id and m.clan_id = v_clan.id
      join public.profiles p on p.id = pb.user_id
      join public.buildings b on b.id = pb.building_id and b.is_active
      where pb.discovered_at >= m.joined_at
      union all
      select jsonb_build_object('kind', 'joined', 'at', m.joined_at, 'username', p.username),
             m.joined_at
      from public.clan_members m
      join public.profiles p on p.id = m.user_id
      where m.clan_id = v_clan.id
      order by at desc
      limit c_chronicle
    ) latest
  ) s;

  return jsonb_build_object(
    'clan', jsonb_build_object(
      'id', v_clan.id,
      'name', v_clan.name,
      'tag', v_clan.tag,
      'ownerId', v_clan.owner_id,
      'avatarPath', v_clan.avatar_path,
      'members', v_count,
      'maxMembers', c_max_members
    ),
    'week', jsonb_build_object(
      -- Monday = 7 days left (today included), Sunday = 1
      'daysLeft', 8 - extract(isodow from v_today)::integer,
      'goal', jsonb_build_object(
        'target', c_goal_per_member * v_count,
        'progress', v_goal_progress,
        'districtId', v_home.id,
        'districtName', v_home.short_name
      )
    ),
    'members', v_members,
    'ownedDistricts', v_owned,
    'metrics', v_metrics,
    'chronicle', v_chronicle
  );
end;
$$;

revoke execute on function public.clan_page() from public, anon, authenticated;
grant execute on function public.clan_page() to authenticated;
