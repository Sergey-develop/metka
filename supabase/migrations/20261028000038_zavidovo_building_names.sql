-- Names for the Zavidovo game buildings (2026-10-28). Published from OSM by migration 027, 33 of the 57 in
-- the resort zone were called just «Здание» (no name, no address in OSM): the camera scan showed
-- «Здание» on the corpuses by the bay. Only generic names are replaced (Здание, Жилой дом, a bare address);
-- real ones (Radisson, SPA Village, the bath houses…) and names set by hand stay.
--
--   1. A Zavidovo place (area_places) names the nearest game building when that stands within 15 m of its
--      point and has a generic name (Жуковка, Гастробар, кемпинг, мини-гольф); partner places first.
--      «Restaurant Cheese factory» (OSM's English name) becomes «Ресторан «СырЗавод»».
--   2. The corpuses on Тверской бульвар by the owner's Yandex screenshot (2026-10-27): 8 — «Эрбелия от
--      Васта», 10 — «Рябина от Васта», 6 — «Бревис Модерн».
--   3. The rest still called «Здание» inside the resort zone: «Здание курорта Завидово».

-- 1. the nearest game building of each place, when it stands in or right by it (≤ 15 m) and has a generic name
with nearest as (
  select p.name, p.is_partner, p.ord, n.building_id
    from public.area_places p
    cross join lateral (
      select b.id as building_id, extensions.st_distance(o.geom::extensions.geography, p.location) as d
        from public.buildings b
        join public.osm_buildings o on o.id = b.osm_building_id
       where b.slug like 'osm-%' and b.publish_status = 'published' and o.geom is not null
         and extensions.st_dwithin(o.geom::extensions.geography, p.location, 15)
       order by extensions.st_distance(o.geom::extensions.geography, p.location)
       limit 1
    ) n
   where p.is_active and p.location is not null
), picked as (
  select distinct on (building_id) building_id, name
    from nearest
   order by building_id, is_partner desc, ord
)
update public.buildings b
   set name = left(pk.name, 160)
  from picked pk, public.osm_buildings o
 where b.id = pk.building_id
   and o.id = b.osm_building_id
   and (b.name in ('Здание', 'Жилой дом') or b.name = o.address);

-- OSM names the cheese restaurant in English
update public.buildings set name = 'Ресторан «СырЗавод»' where slug like 'osm-%' and name = 'Restaurant Cheese factory';

update public.buildings b
   set name = v.name
  from (values
    ('osm-w1453335155', 'Эрбелия от Васта'),
    ('osm-w1453335154', 'Рябина от Васта'),
    ('osm-w1084410864', 'Бревис Модерн')
  ) as v(slug, name)
 where b.slug = v.slug;

update public.buildings b
   set name = 'Здание курорта Завидово'
  from public.area_zones z
 where z.id = 'zavidovo-core'
   and b.slug like 'osm-%'
   and b.name = 'Здание'
   and extensions.st_covers(z.boundary, b.location);
