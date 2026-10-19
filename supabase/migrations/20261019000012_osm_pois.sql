-- Organisations from OpenStreetMap (shops, cafés, offices, …) and their link to osm_buildings.
--
-- A building and an organisation are different objects. An organisation is linked to a building
-- only when the data proves it:
--   explicit          — the OSM node is a vertex of exactly one building way (mapped on its outline);
--   inside_footprint  — the point lies inside exactly one building footprint.
-- Proximity alone never links: a POI outside every footprint, or inside overlapping footprints,
-- stays unlinked (osm_building_id null) and is not shown on any building card.
-- Data © OpenStreetMap contributors, ODbL. Written only by the import (service role).

create table public.osm_pois (
  id              bigint generated always as identity primary key,
  osm_type        text not null check (osm_type = 'node'),
  osm_id          bigint not null check (osm_id > 0),
  point           extensions.geometry(Point, 4326) not null,
  name            text not null check (char_length(name) between 1 and 300),
  kind_key        text not null check (kind_key in ('amenity', 'shop', 'office', 'craft', 'healthcare', 'tourism', 'leisure')),
  kind_value      text not null check (kind_value ~ '^[a-z0-9_;:-]{1,64}$'),
  tags            jsonb not null default '{}'::jsonb check (jsonb_typeof(tags) = 'object'),
  osm_building_id bigint references public.osm_buildings (id) on delete set null,
  -- meaningful only while osm_building_id is set
  link_method     text check (link_method in ('explicit', 'inside_footprint')),
  imported_at     timestamptz not null default now(),
  -- last import that changed the POI or its link
  updated_at      timestamptz not null default now(),
  unique (osm_type, osm_id)
);
create index osm_pois_point_gix on public.osm_pois using gist (point);
create index osm_pois_building_idx on public.osm_pois (osm_building_id) where osm_building_id is not null;

alter table public.osm_pois enable row level security;
revoke all on public.osm_pois from anon, authenticated;
grant select on public.osm_pois to authenticated;
create policy osm_pois_read on public.osm_pois for select to authenticated using (true);

-- Which building a POI belongs to, by the rules above. p_host_way_ids: OSM ids of building ways
-- that have this node as a vertex (from Overpass `way(bn)`).
create or replace function public._osm_poi_link(
  p_point extensions.geometry,
  p_host_way_ids bigint[],
  out building_id bigint,
  out method text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ids bigint[];
begin
  if coalesce(cardinality(p_host_way_ids), 0) > 0 then
    select array_agg(o.id) into v_ids
    from public.osm_buildings o
    where o.osm_type = 'way' and o.osm_id = any (p_host_way_ids);
    if cardinality(v_ids) = 1 then
      building_id := v_ids[1];
      method := 'explicit';
      return;
    end if;
  end if;

  select array_agg(o.id) into v_ids
  from public.osm_buildings o
  where o.geom operator(extensions.&&) p_point and extensions.st_covers(o.geom, p_point);
  if cardinality(v_ids) = 1 then
    building_id := v_ids[1];
    method := 'inside_footprint';
  end if;
end;
$$;

-- Upsert by (osm_type, osm_id). Item: { osmType: 'node', osmId, lng, lat, name, kindKey, kindValue,
-- tags: {…}, hostWayIds: [way ids] }. Returns counts and skipped items with a reason.
create or replace function public.import_osm_pois(p_items jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
  v_id bigint;
  v_point extensions.geometry;
  v_hosts bigint[];
  v_link record;
  v_inserted boolean;
  v_counts integer[] := array[0, 0, 0];
  v_skipped jsonb := '[]'::jsonb;
  v_reason text;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 5000 then
    raise exception 'batch_too_large' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_id := null;
    begin
      if v_item ->> 'osmType' is distinct from 'node' or coalesce(v_item ->> 'osmId', '') !~ '^[1-9][0-9]{0,17}$' then
        raise exception 'invalid_id';
      end if;
      v_id := (v_item ->> 'osmId')::bigint;

      if jsonb_typeof(v_item -> 'lng') <> 'number' or jsonb_typeof(v_item -> 'lat') <> 'number'
         or abs((v_item ->> 'lng')::double precision) > 180 or abs((v_item ->> 'lat')::double precision) > 90 then
        raise exception 'invalid_coordinates';
      end if;
      v_point := extensions.st_setsrid(
        extensions.st_makepoint((v_item ->> 'lng')::double precision, (v_item ->> 'lat')::double precision), 4326);

      if coalesce(btrim(v_item ->> 'name'), '') = '' then
        raise exception 'no_name';
      end if;
      if coalesce(v_item ->> 'kindKey', '') not in ('amenity', 'shop', 'office', 'craft', 'healthcare', 'tourism', 'leisure')
         or coalesce(v_item ->> 'kindValue', '') !~ '^[a-z0-9_;:-]{1,64}$' then
        raise exception 'invalid_kind';
      end if;

      select coalesce(array_agg((h.value #>> '{}')::bigint), '{}') into v_hosts
      from jsonb_array_elements(case when jsonb_typeof(v_item -> 'hostWayIds') = 'array' then v_item -> 'hostWayIds' else '[]'::jsonb end) h
      where jsonb_typeof(h.value) = 'number' and (h.value #>> '{}') ~ '^[1-9][0-9]{0,17}$';

      select * into v_link from public._osm_poi_link(v_point, v_hosts);

      insert into public.osm_pois as p (osm_type, osm_id, point, name, kind_key, kind_value, tags, osm_building_id, link_method)
      values (
        'node', v_id, v_point,
        left(btrim(v_item ->> 'name'), 300),
        v_item ->> 'kindKey', v_item ->> 'kindValue',
        case when jsonb_typeof(v_item -> 'tags') = 'object' then v_item -> 'tags' else '{}'::jsonb end,
        v_link.building_id, v_link.method
      )
      on conflict (osm_type, osm_id) do update
        set point = excluded.point, name = excluded.name, kind_key = excluded.kind_key,
            kind_value = excluded.kind_value, tags = excluded.tags,
            osm_building_id = excluded.osm_building_id, link_method = excluded.link_method,
            imported_at = now(), updated_at = now()
        where (extensions.st_asbinary(p.point), p.name, p.kind_key, p.kind_value, p.tags, p.osm_building_id, p.link_method)
              is distinct from (extensions.st_asbinary(excluded.point), excluded.name, excluded.kind_key,
                                excluded.kind_value, excluded.tags, excluded.osm_building_id, excluded.link_method)
      returning (xmax = 0) into v_inserted;

      if not found then
        v_counts[3] := v_counts[3] + 1;
        update public.osm_pois set imported_at = now() where osm_type = 'node' and osm_id = v_id;
      elsif v_inserted then
        v_counts[1] := v_counts[1] + 1;
      else
        v_counts[2] := v_counts[2] + 1;
      end if;
    exception when others then
      v_reason := case when sqlerrm in ('invalid_id', 'invalid_coordinates', 'no_name', 'invalid_kind')
                       then sqlerrm else 'invalid_item' end;
      v_skipped := v_skipped || jsonb_build_object('osmType', 'node', 'osmId', v_id, 'reason', v_reason);
    end;
  end loop;

  return jsonb_build_object('inserted', v_counts[1], 'updated', v_counts[2], 'unchanged', v_counts[3],
                            'skipped', v_skipped);
end;
$$;

-- After a buildings re-import footprints may change: recompute footprint links. Explicit links
-- are kept while their building still exists (the vertex list is not stored here).
create or replace function public.relink_osm_pois()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_changed integer;
begin
  with relinked as (
    select p.id, l.building_id, l.method
    from public.osm_pois p
    cross join lateral public._osm_poi_link(p.point, '{}'::bigint[]) l
    where p.link_method is distinct from 'explicit' or p.osm_building_id is null
  )
  update public.osm_pois p
     set osm_building_id = r.building_id, link_method = r.method, updated_at = now()
    from relinked r
   where p.id = r.id
     and (p.osm_building_id, p.link_method) is distinct from (r.building_id, r.method);
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke execute on function public._osm_poi_link(extensions.geometry, bigint[]) from public, anon, authenticated;
revoke execute on function public.import_osm_pois(jsonb) from public, anon, authenticated;
revoke execute on function public.relink_osm_pois() from public, anon, authenticated;
grant execute on function public.import_osm_pois(jsonb) to service_role;
grant execute on function public.relink_osm_pois() to service_role;
grant execute on function public._osm_poi_link(extensions.geometry, bigint[]) to service_role;
