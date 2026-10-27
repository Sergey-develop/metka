-- Two finished resort buildings on Тверской бульвар are still tagged building=construction in OSM
-- (2026-10-25 export), so publish_osm_buildings_in_zone (027) skipped them: on the map they were only a
-- near-invisible plain outline, while Yandex shows them (owner's screenshot, 2026-10-27):
--   * relation/14440980 — Тверской бульвар, 12, «Завидово Аква & SPA» (restaurant «Аквамарин» inside)
--   * way/1084410864    — Тверской бульвар, 6
-- Other construction footprints of the zone (улица Чистый Плёс) are left alone: not checked on the ground.
--
-- Their OSM rows lose the «Строится» category. A new osm:import brings the OSM tags back (the card would
-- say «Строится» again) but keeps the game buildings; better fix the tags in OSM itself.

update public.osm_buildings o
   set category = null,
       tags = o.tags || '{"building": "yes"}'::jsonb
 where (o.osm_type, o.osm_id) in (('relation', 14440980), ('way', 1084410864))
   and o.tags ->> 'building' = 'construction';

insert into public.buildings (slug, name, address, district_id, location, publish_status, osm_building_id)
select
  'osm-' || left(o.osm_type, 1) || o.osm_id,
  case when o.osm_type = 'relation' and o.osm_id = 14440980 then 'Завидово Аква & SPA'
       else left(coalesce(o.name, o.address, 'Здание'), 160) end,
  o.address,
  null,
  o.centroid::extensions.geography,
  'published',
  o.id
from public.osm_buildings o
join public.area_zones z on z.id = 'zavidovo-core'
where (o.osm_type, o.osm_id) in (('relation', 14440980), ('way', 1084410864))
  and extensions.st_covers(z.boundary, o.centroid::extensions.geography)
on conflict do nothing;
