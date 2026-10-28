-- Events in Zavidovo (2026-10-28): create_event only took a meeting point inside a Moscow okrug, so with
-- the app on Zavidovo alone no event could be made there. The point must now be in a game area
-- (in_game_area, migration 026: Moscow or Zavidovo). Otherwise the function is that of migration 018.

create or replace function public.create_event(
  p_kind text,
  p_title text,
  p_description text,
  p_lat double precision,
  p_lng double precision,
  p_starts_at timestamptz,
  p_max_participants integer,
  p_cover_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- at least this far ahead, so others can still sign up
  c_min_lead constant interval := interval '15 minutes';
  c_max_lead constant interval := interval '90 days';
  -- upcoming events one player may have at once (spam guard)
  c_max_upcoming constant integer := 5;
  c_place_radius_m constant integer := 200;
  v_uid uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_point extensions.geography;
  v_place text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('run', 'walk', 'reading', 'cleanup')
     or char_length(v_title) not between 3 and 80
     or char_length(coalesce(v_description, '')) > 500
     or p_max_participants is null or p_max_participants not between 2 and 100
     or p_starts_at is null or p_starts_at < now() + c_min_lead or p_starts_at > now() + c_max_lead then
    raise exception 'invalid_event' using errcode = '22023';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid_location' using errcode = '22023';
  end if;
  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
  -- the meeting point must be in a game area: Moscow or Zavidovo (migration 035; was: inside a Moscow okrug)
  if not public.in_game_area(p_lat, p_lng) then
    raise exception 'invalid_location' using errcode = '22023';
  end if;
  if p_cover_path is not null
     and (p_cover_path !~ ('^' || v_uid::text || '/[0-9a-f-]{36}\.(webp|jpg)$')
          or not exists (select 1 from storage.objects where bucket_id = 'event-covers' and name = p_cover_path)) then
    raise exception 'invalid_photo' using errcode = '22023';
  end if;

  -- serialize one player's creations so the limit cannot be raced
  perform 1 from public.profiles where id = v_uid for update;
  if (select count(*) from public.events where creator_id = v_uid and starts_at > now()) >= c_max_upcoming then
    raise exception 'too_many_events' using errcode = 'P0001';
  end if;

  select nullif(btrim(b.address), '') into v_place
  from public.osm_buildings b
  where b.address is not null
    and extensions.st_dwithin(b.centroid::extensions.geography, v_point, c_place_radius_m)
  order by b.centroid operator(extensions.<->) v_point::extensions.geometry
  limit 1;

  insert into public.events (creator_id, kind, title, description, location, place_name, starts_at, max_participants, cover_path)
  values (v_uid, p_kind, v_title, v_description, v_point, left(v_place, 160), p_starts_at, p_max_participants, p_cover_path)
  returning id into v_id;
  insert into public.event_participants (event_id, user_id) values (v_id, v_uid);
  return v_id;
end;
$$;

