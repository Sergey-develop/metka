-- Second game area: Zavidovo resort (Tver region), next to Moscow; and a bulk import of game buildings.
--
-- 1. Game areas. Until now the game area was one rectangle around Moscow (lat 55.1–56.2,
--    lng 36.8–38.4), hard-coded in record_exploration. in_game_area() now holds the list:
--      Moscow incl. New Moscow  lat 55.1–56.2,   lng 36.8–38.4
--      Zavidovo                 lat 56.57–56.62, lng 36.48–36.58
--    The client mirrors it (src/services/map/yandexMap.ts: GAME_AREAS). The exploration grid is
--    global (y = floor((lat + 90) / 0.0001), x = floor((lng + 180) / 0.00018)), so no cell changes;
--    at 56.6°N a cell is ≈11.1 × 11.0 m, the corridor rules hold. record_exploration is the body of
--    migration 014 with only the area check replaced.
-- 2. publish_osm_buildings_in_bbox(): makes the imported OSM outlines of a bbox published game
--    buildings in one call, for tools/osm-import (service role only; admin_save_game_building needs
--    a signed-in admin). Outhouses (garage, shed, …) are skipped; buildings already in the catalog
--    are left as they are. Outside Moscow there is no okrug: district_id stays null, so such
--    buildings give XP and coins but no influence (submit_building_scan already handles that).

create or replace function public.in_game_area(p_lat double precision, p_lng double precision)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_lat between 55.1 and 56.2 and p_lng between 36.8 and 38.4)
      or (p_lat between 56.57 and 56.62 and p_lng between 36.48 and 36.58)
$$;

create or replace function public.record_exploration(p_points jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_accuracy constant double precision := 35;
  c_max_speed constant double precision := 7;      -- m/s: brisk run / slow bike
  c_gap_s constant double precision := 30;
  c_outlier_window_s constant double precision := 120;
  c_half_width_m constant double precision := 18;
  c_window_cap constant integer := 2000;
  v_uid uuid := auth.uid();
  v_state public.exploration_state;
  v_p jsonb;
  v_lat double precision;
  v_lng double precision;
  v_acc double precision;
  v_t timestamptz;
  v_prev_lat double precision;
  v_prev_lng double precision;
  v_prev_t timestamptz;
  v_dt double precision;
  v_d double precision;
  v_cells jsonb := '[]'::jsonb;
  v_rejected jsonb := '{}'::jsonb;
  v_reason text;
  v_accepted integer := 0;
  v_new jsonb;
  v_new_count integer;
  v_total integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_points) is distinct from 'array' or jsonb_array_length(p_points) > 300 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  insert into public.exploration_state (user_id) values (v_uid) on conflict (user_id) do nothing;
  select * into v_state from public.exploration_state where user_id = v_uid for update;
  v_prev_lat := v_state.last_lat;
  v_prev_lng := v_state.last_lng;
  v_prev_t := v_state.last_at;

  for v_p in select value from jsonb_array_elements(p_points) loop
    v_reason := null;
    begin
      v_lat := (v_p ->> 'lat')::double precision;
      v_lng := (v_p ->> 'lng')::double precision;
      v_acc := (v_p ->> 'accuracy')::double precision;
      v_t := to_timestamp((v_p ->> 't')::double precision / 1000);
    exception when others then
      v_reason := 'invalid';
    end;
    if v_reason is null and (v_lat is null or v_lng is null or v_acc is null or v_t is null
        or v_lat <> v_lat or v_lng <> v_lng or v_acc < 0) then  -- x <> x catches NaN
      v_reason := 'invalid';
    end if;
    -- game areas: Moscow incl. New Moscow, Zavidovo (in_game_area)
    if v_reason is null and not public.in_game_area(v_lat, v_lng) then
      v_reason := 'outside_area';
    end if;
    if v_reason is null and v_acc > c_max_accuracy then
      v_reason := 'inaccurate';
    end if;
    if v_reason is null and (v_t > now() + interval '30 seconds' or v_t < now() - interval '30 minutes') then
      v_reason := 'bad_time';
    end if;
    if v_reason is null and v_prev_t is not null and v_t <= v_prev_t then
      v_reason := 'out_of_order';
    end if;

    if v_reason is null and v_prev_t is not null then
      v_dt := extract(epoch from (v_t - v_prev_t));
      v_d := extensions.st_distance(
        extensions.st_setsrid(extensions.st_makepoint(v_prev_lng, v_prev_lat), 4326)::extensions.geography,
        extensions.st_setsrid(extensions.st_makepoint(v_lng, v_lat), 4326)::extensions.geography);
      if v_dt <= c_outlier_window_s and v_d / v_dt > c_max_speed then
        v_reason := 'too_fast';
      elsif v_dt <= c_gap_s and v_d > 0 then
        select v_cells || coalesce(jsonb_agg(jsonb_build_array(c.cell_y, c.cell_x)), '[]'::jsonb)
          into v_cells
          from public._corridor_cells(v_prev_lat, v_prev_lng, v_lat, v_lng, c_half_width_m) c;
      end if;
      -- gap > 30 s or no movement: the fix only becomes the new anchor
    end if;

    if v_reason is null then
      v_accepted := v_accepted + 1;
      v_prev_lat := v_lat;
      v_prev_lng := v_lng;
      v_prev_t := v_t;
    else
      v_rejected := jsonb_set(v_rejected, array[v_reason], to_jsonb(coalesce((v_rejected ->> v_reason)::integer, 0) + 1));
    end if;
  end loop;

  -- rate limit window
  if v_state.window_start < now() - interval '10 minutes' then
    v_state.window_start := now();
    v_state.window_cells := 0;
  end if;

  with candidates as (
    select distinct (c ->> 0)::integer as y, (c ->> 1)::integer as x
    from jsonb_array_elements(v_cells) as c
    limit greatest(c_window_cap - v_state.window_cells, 0)
  ), inserted as (
    insert into public.explored_cells (user_id, cell_y, cell_x)
    select v_uid, y, x from candidates
    on conflict do nothing
    returning cell_y, cell_x
  )
  select coalesce(jsonb_agg(jsonb_build_array(cell_y, cell_x)), '[]'::jsonb), count(*)::integer
    into v_new, v_new_count
    from inserted;

  update public.exploration_state set
    last_lat = v_prev_lat,
    last_lng = v_prev_lng,
    last_at = v_prev_t,
    window_start = v_state.window_start,
    window_cells = v_state.window_cells + v_new_count,
    updated_at = now()
  where user_id = v_uid;

  select count(*)::integer into v_total from public.explored_cells where user_id = v_uid;
  return jsonb_build_object('accepted', v_accepted, 'rejected', v_rejected, 'newCells', v_new, 'totalCells', v_total);
end;
$$;

revoke execute on function public.record_exploration(jsonb) from public, anon, authenticated;
grant execute on function public.record_exploration(jsonb) to authenticated;
revoke execute on function public.in_game_area(double precision, double precision) from public, anon;
grant execute on function public.in_game_area(double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- bulk publication of imported outlines
-- ---------------------------------------------------------------------------
create or replace function public.publish_osm_buildings_in_bbox(
  p_min_lat double precision,
  p_min_lng double precision,
  p_max_lat double precision,
  p_max_lng double precision,
  p_skip_types text[] default array['garage', 'garages', 'shed', 'service', 'construction', 'hut', 'kiosk',
                                    'roof', 'carport', 'transformer_tower', 'toilets', 'greenhouse', 'ruins']
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created integer;
  v_published integer;
begin
  if p_min_lat is null or p_min_lng is null or p_max_lat is null or p_max_lng is null
     or p_min_lat >= p_max_lat or p_min_lng >= p_max_lng
     or p_max_lat - p_min_lat > 0.1 or p_max_lng - p_min_lng > 0.2 then
    raise exception 'invalid_bbox' using errcode = '22023';
  end if;

  with picked as (
    select o.*
      from public.osm_buildings o
     where o.centroid operator(extensions.&&) extensions.st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)
       and public.in_game_area(extensions.st_y(o.centroid), extensions.st_x(o.centroid))
       and not (coalesce(o.tags ->> 'building', 'yes') = any (p_skip_types))
  ), created as (
    insert into public.buildings (slug, name, address, district_id, location, publish_status, osm_building_id)
    select
      'osm-' || left(p.osm_type, 1) || p.osm_id,
      left(coalesce(
        p.name,
        p.address,
        case when p.tags ->> 'building' in ('house', 'detached', 'residential', 'apartments', 'terrace', 'semidetached_house')
             then 'Жилой дом' else 'Здание' end
      ), 160),
      p.address,
      (select d.id from public.districts d
        where extensions.st_covers(d.boundary, p.centroid::extensions.geography) limit 1),
      p.centroid::extensions.geography,
      'published',
      p.id
    from picked p
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into v_created from created;

  -- outlines of this bbox already in the catalog as drafts (e.g. saved by hand) are left alone
  select count(*)::integer into v_published
    from public.buildings b
    join public.osm_buildings o on o.id = b.osm_building_id
   where o.centroid operator(extensions.&&) extensions.st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)
     and b.publish_status = 'published';

  return jsonb_build_object('created', v_created, 'publishedInBbox', v_published);
end;
$$;

revoke execute on function public.publish_osm_buildings_in_bbox(double precision, double precision, double precision, double precision, text[]) from public, anon, authenticated;
grant execute on function public.publish_osm_buildings_in_bbox(double precision, double precision, double precision, double precision, text[]) to service_role;
