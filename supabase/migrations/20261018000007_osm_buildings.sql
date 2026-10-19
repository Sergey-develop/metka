-- Building geometry (map layer B) and the game catalog's link to it (layer C).
--
-- osm_buildings: footprints imported from OpenStreetMap GeoJSON (ODbL; the map shows
--   "© OpenStreetMap"). Written only by import_osm_buildings() with the service role.
--   Re-importing never touches public.buildings, so game settings survive.
-- buildings (the game catalog, see ADR in PROJECT_STATUS): optionally references one OSM
--   building; publish_status decides visibility. Only admins change it, via RPCs below.

-- ---------------------------------------------------------------------------
-- admins: managed with SQL / service role only (no client grants)
-- ---------------------------------------------------------------------------
create table public.app_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins where user_id = (select auth.uid()))
$$;

-- ---------------------------------------------------------------------------
-- imported OSM buildings
-- ---------------------------------------------------------------------------
create table public.osm_buildings (
  id          bigint generated always as identity primary key,
  osm_type    text not null check (osm_type in ('node', 'way', 'relation')),
  osm_id      bigint not null check (osm_id > 0),
  -- footprint; null only for buildings mapped as a single node (shown as a neutral dot)
  geom        extensions.geometry(MultiPolygon, 4326),
  -- point guaranteed inside the footprint (ST_PointOnSurface); the node itself for nodes
  centroid    extensions.geometry(Point, 4326) not null,
  name        text check (char_length(name) <= 300),
  address     text check (char_length(address) <= 300),
  category    text check (char_length(category) <= 64),
  tags        jsonb not null default '{}'::jsonb check (jsonb_typeof(tags) = 'object'),
  imported_at timestamptz not null default now(),
  -- last import that changed geometry or tags
  updated_at  timestamptz not null default now(),
  unique (osm_type, osm_id),
  check ((geom is null) = (osm_type = 'node'))
);
create index osm_buildings_geom_gix on public.osm_buildings using gist (geom);
create index osm_buildings_centroid_gix on public.osm_buildings using gist (centroid);

alter table public.osm_buildings enable row level security;
revoke all on public.osm_buildings from anon, authenticated;
grant select on public.osm_buildings to authenticated;
create policy osm_buildings_read on public.osm_buildings for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- game catalog: link to geometry + publication workflow
-- ---------------------------------------------------------------------------
alter table public.buildings
  add column osm_building_id bigint unique references public.osm_buildings (id) on delete restrict,
  add column category text check (char_length(category) <= 64),
  -- stored for the catalog UI; not enforced by submit_building_scan yet
  add column unlock_conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(unlock_conditions) = 'object'),
  add column publish_status text not null default 'published'
    check (publish_status in ('draft', 'published', 'unavailable', 'hidden'));

update public.buildings set publish_status = 'hidden' where not is_active;

-- Every existing game function checks is_active, so it stays the single "playable" flag,
-- derived from publish_status. Inserts that only set is_active = false keep working.
create or replace function public.sync_building_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and not new.is_active and new.publish_status = 'published' then
    new.publish_status := 'hidden';
  end if;
  new.is_active := new.publish_status = 'published';
  return new;
end;
$$;
create trigger buildings_sync_active before insert or update on public.buildings
  for each row execute function public.sync_building_active();

-- 'unavailable' buildings stay readable (greyed out on the map) but are not playable
drop policy buildings_read on public.buildings;
create policy buildings_read on public.buildings for select to authenticated
  using (publish_status in ('published', 'unavailable'));

-- ---------------------------------------------------------------------------
-- import (service role only)
-- ---------------------------------------------------------------------------
-- p_features: [{osmType, osmId, geometry (GeoJSON Polygon|MultiPolygon, Point for nodes),
--               name, address, category, tags}], already validated by tools/osm-import.
-- The server re-validates: invalid rings are repaired with ST_MakeValid or skipped.
-- Returns {inserted, updated, unchanged, skipped: [{osmType, osmId, reason}]}.
create or replace function public.import_osm_buildings(p_features jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_f jsonb;
  v_type text;
  v_id bigint;
  v_geom extensions.geometry;
  v_point extensions.geometry;
  v_inserted boolean;
  v_counts integer[] := array[0, 0, 0];
  v_skipped jsonb := '[]'::jsonb;
  v_reason text;
begin
  if jsonb_typeof(p_features) is distinct from 'array' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if jsonb_array_length(p_features) > 5000 then
    raise exception 'batch_too_large' using errcode = '22023';
  end if;

  for v_f in select value from jsonb_array_elements(p_features) loop
    v_type := v_f ->> 'osmType';
    v_id := null;
    begin
      v_id := (v_f ->> 'osmId')::bigint;
      if v_type is null or v_type not in ('node', 'way', 'relation') or v_id is null or v_id <= 0 then
        raise exception 'invalid_id';
      end if;

      begin
        v_geom := extensions.st_setsrid(extensions.st_geomfromgeojson(v_f -> 'geometry'), 4326);
      exception when others then
        raise exception 'invalid_geometry';
      end;
      if extensions.st_xmin(v_geom) < -180 or extensions.st_xmax(v_geom) > 180
         or extensions.st_ymin(v_geom) < -90 or extensions.st_ymax(v_geom) > 90 then
        raise exception 'invalid_coordinates';
      end if;

      if v_type = 'node' then
        if extensions.geometrytype(v_geom) <> 'POINT' then
          raise exception 'invalid_geometry';
        end if;
        v_point := v_geom;
        v_geom := null;
      else
        if extensions.geometrytype(v_geom) not in ('POLYGON', 'MULTIPOLYGON') then
          raise exception 'invalid_geometry';
        end if;
        if not extensions.st_isvalid(v_geom) then
          v_geom := extensions.st_collectionextract(extensions.st_makevalid(v_geom), 3);
        end if;
        if v_geom is null or extensions.st_isempty(v_geom) or extensions.st_area(v_geom) = 0 then
          raise exception 'invalid_geometry';
        end if;
        v_geom := extensions.st_multi(v_geom);
        v_point := extensions.st_pointonsurface(v_geom);

        -- same footprint already stored under another OSM id (e.g. way + relation)
        if exists (
          select 1 from public.osm_buildings o
          where o.geom operator(extensions.~=) v_geom
            and (o.osm_type, o.osm_id) <> (v_type, v_id)
            and extensions.st_equals(o.geom, v_geom)
        ) then
          raise exception 'duplicate_geometry';
        end if;
      end if;

      insert into public.osm_buildings as o (osm_type, osm_id, geom, centroid, name, address, category, tags)
      values (
        v_type, v_id, v_geom, v_point,
        nullif(left(btrim(v_f ->> 'name'), 300), ''),
        nullif(left(btrim(v_f ->> 'address'), 300), ''),
        nullif(left(btrim(v_f ->> 'category'), 64), ''),
        case when jsonb_typeof(v_f -> 'tags') = 'object' then v_f -> 'tags' else '{}'::jsonb end
      )
      on conflict (osm_type, osm_id) do update
        set geom = excluded.geom, centroid = excluded.centroid, name = excluded.name,
            address = excluded.address, category = excluded.category, tags = excluded.tags,
            updated_at = now()
        -- geometries compared as WKB: exact, null-safe, no operator lookup through search_path
        where (extensions.st_asbinary(o.geom), extensions.st_asbinary(o.centroid), o.name, o.address, o.category, o.tags)
              is distinct from (extensions.st_asbinary(excluded.geom), extensions.st_asbinary(excluded.centroid),
                                excluded.name, excluded.address, excluded.category, excluded.tags)
      returning (xmax = 0) into v_inserted;

      if not found then
        v_counts[3] := v_counts[3] + 1;
      elsif v_inserted then
        v_counts[1] := v_counts[1] + 1;
      else
        v_counts[2] := v_counts[2] + 1;
      end if;
    exception when others then
      v_reason := case when sqlerrm in ('invalid_id', 'invalid_geometry', 'invalid_coordinates', 'duplicate_geometry')
                       then sqlerrm else 'invalid_feature' end;
      v_skipped := v_skipped || jsonb_build_object('osmType', v_type, 'osmId', v_id, 'reason', v_reason);
    end;
  end loop;

  return jsonb_build_object('inserted', v_counts[1], 'updated', v_counts[2], 'unchanged', v_counts[3],
                            'skipped', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- map: footprints in the viewport with their game state
-- ---------------------------------------------------------------------------
-- Shared body; security definer, so callers must pass the statuses they may see.
-- Game buildings come first, so truncation drops plain footprints, never game objects.
-- Geometry is simplified to ~half a screen pixel at p_zoom.
create or replace function public._osm_features_in_bbox(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision,
  p_zoom double precision,
  p_limit integer,
  p_statuses text[],
  p_admin boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_env extensions.geometry;
  v_limit integer := least(greatest(coalesce(p_limit, 1500), 1), 3000);
  v_tol double precision := 360.0 / (512 * power(2, least(greatest(coalesce(p_zoom, 16), 10), 20)));
  v_result jsonb;
begin
  if p_min_lng is null or p_min_lat is null or p_max_lng is null or p_max_lat is null
     or p_min_lng >= p_max_lng or p_min_lat >= p_max_lat
     or p_min_lng < -180 or p_max_lng > 180 or p_min_lat < -90 or p_max_lat > 90 then
    raise exception 'invalid_bbox' using errcode = '22023';
  end if;
  if (p_max_lng - p_min_lng) > 0.1 or (p_max_lat - p_min_lat) > 0.1 then
    raise exception 'bbox_too_large' using errcode = '22023';
  end if;
  v_env := extensions.st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326);

  with hits as (
    select o.*, b.id as game_id, b.name as game_name, b.description, b.category as game_category,
           b.rarity, b.publish_status, b.image_url, b.reward_xp, b.reward_coins, b.reward_influence,
           b.scan_radius_m, b.unlock_conditions, pb.discovered_at
    from public.osm_buildings o
    left join public.buildings b
      on b.osm_building_id = o.id and b.publish_status = any (p_statuses)
    left join public.player_buildings pb
      on pb.building_id = b.id and pb.user_id = (select auth.uid())
    where (o.geom operator(extensions.&&) v_env and extensions.st_intersects(o.geom, v_env))
       or (o.geom is null and o.centroid operator(extensions.&&) v_env)
    order by (b.id is null), o.id
    limit v_limit + 1
  ), numbered as (
    select h.*, row_number() over (order by (h.game_id is null), h.id) as rn from hits h
  )
  select jsonb_build_object(
    'truncated', count(*) > v_limit,
    'features', coalesce(jsonb_agg(
      jsonb_build_object(
        'type', 'Feature',
        'id', n.id,
        'geometry', extensions.st_asgeojson(
          coalesce(extensions.st_simplifypreservetopology(n.geom, v_tol), n.centroid), 6)::jsonb,
        'properties', jsonb_strip_nulls(jsonb_build_object(
          'osmType', n.osm_type,
          'osmId', n.osm_id,
          'name', n.name,
          'address', n.address,
          'category', n.category,
          'gameBuildingId', n.game_id,
          'gameStatus', n.publish_status,
          'gameName', n.game_name,
          'description', n.description,
          'gameCategory', n.game_category,
          'rarity', n.rarity,
          'imageUrl', n.image_url,
          'discoveredAt', n.discovered_at
        ) || case when p_admin and n.game_id is not null then jsonb_build_object(
          'rewardXp', n.reward_xp, 'rewardCoins', n.reward_coins, 'rewardInfluence', n.reward_influence,
          'scanRadiusM', n.scan_radius_m, 'unlockConditions', n.unlock_conditions)
        else '{}'::jsonb end)
      ) order by n.rn) filter (where n.rn <= v_limit), '[]'::jsonb)
  ) into v_result
  from numbered n;

  return v_result;
end;
$$;

create or replace function public.osm_buildings_in_bbox(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision,
  p_zoom double precision default 16,
  p_limit integer default 1500
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public._osm_features_in_bbox(p_min_lng, p_min_lat, p_max_lng, p_max_lat, p_zoom, p_limit,
                                      array['published', 'unavailable'], false)
$$;

-- ---------------------------------------------------------------------------
-- catalog administration (admins only)
-- ---------------------------------------------------------------------------
create or replace function public._require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.admin_catalog_in_bbox(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision,
  p_zoom double precision default 16,
  p_limit integer default 1500
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_admin();
  return public._osm_features_in_bbox(p_min_lng, p_min_lat, p_max_lng, p_max_lat, p_zoom, p_limit,
                                      array['draft', 'published', 'unavailable', 'hidden'], true);
end;
$$;

-- Creates the game building for an OSM building (as a draft) or updates its settings.
-- p_data keys (all optional): name, description, category, rarity, imageUrl, unlockConditions,
-- rewardXp, rewardCoins, rewardInfluence, scanRadiusM. Never changes publish_status.
create or replace function public.admin_save_game_building(p_osm_building_id bigint, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_osm public.osm_buildings;
  v_id uuid;
begin
  perform public._require_admin();
  if jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_data ? 'imageUrl' and p_data ->> 'imageUrl' !~ '^https://[^\s"<>]+$' then
    raise exception 'invalid_image_url' using errcode = '22023';
  end if;
  if p_data ? 'unlockConditions' and jsonb_typeof(p_data -> 'unlockConditions') <> 'object' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_osm from public.osm_buildings where id = p_osm_building_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  insert into public.buildings (slug, name, address, district_id, location, publish_status, osm_building_id)
  values (
    'osm-' || left(v_osm.osm_type, 1) || v_osm.osm_id,
    coalesce(v_osm.name, v_osm.address, 'Здание'),
    v_osm.address,
    (select d.id from public.districts d
      where extensions.st_covers(d.boundary, v_osm.centroid::extensions.geography) limit 1),
    v_osm.centroid::extensions.geography,
    'draft',
    v_osm.id
  )
  on conflict (osm_building_id) do nothing;

  update public.buildings b set
    name             = case when p_data ? 'name' then btrim(p_data ->> 'name') else b.name end,
    description      = case when p_data ? 'description' then nullif(btrim(p_data ->> 'description'), '') else b.description end,
    category         = case when p_data ? 'category' then nullif(btrim(p_data ->> 'category'), '') else b.category end,
    rarity           = coalesce(p_data ->> 'rarity', b.rarity),
    image_url        = case when p_data ? 'imageUrl' then p_data ->> 'imageUrl' else b.image_url end,
    unlock_conditions = coalesce(p_data -> 'unlockConditions', b.unlock_conditions),
    reward_xp        = coalesce((p_data ->> 'rewardXp')::integer, b.reward_xp),
    reward_coins     = coalesce((p_data ->> 'rewardCoins')::integer, b.reward_coins),
    reward_influence = coalesce((p_data ->> 'rewardInfluence')::integer, b.reward_influence),
    scan_radius_m    = coalesce((p_data ->> 'scanRadiusM')::integer, b.scan_radius_m)
  where b.osm_building_id = v_osm.id
  returning b.id into v_id;

  return v_id;
end;
$$;

create or replace function public.admin_set_game_building_status(p_building_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_admin();
  if p_status is null or p_status not in ('draft', 'published', 'unavailable', 'hidden') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  update public.buildings set publish_status = p_status where id = p_building_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------
revoke execute on function public.is_admin() from public, anon, authenticated;
revoke execute on function public.sync_building_active() from public, anon, authenticated;
revoke execute on function public.import_osm_buildings(jsonb) from public, anon, authenticated;
revoke execute on function public._osm_features_in_bbox(double precision, double precision, double precision, double precision, double precision, integer, text[], boolean) from public, anon, authenticated;
revoke execute on function public.osm_buildings_in_bbox(double precision, double precision, double precision, double precision, double precision, integer) from public, anon, authenticated;
revoke execute on function public._require_admin() from public, anon, authenticated;
revoke execute on function public.admin_catalog_in_bbox(double precision, double precision, double precision, double precision, double precision, integer) from public, anon, authenticated;
revoke execute on function public.admin_save_game_building(bigint, jsonb) from public, anon, authenticated;
revoke execute on function public.admin_set_game_building_status(uuid, text) from public, anon, authenticated;

grant execute on function public.import_osm_buildings(jsonb) to service_role;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.osm_buildings_in_bbox(double precision, double precision, double precision, double precision, double precision, integer) to authenticated;
grant execute on function public.admin_catalog_in_bbox(double precision, double precision, double precision, double precision, double precision, integer) to authenticated;
grant execute on function public.admin_save_game_building(bigint, jsonb) to authenticated;
grant execute on function public.admin_set_game_building_status(uuid, text) to authenticated;
