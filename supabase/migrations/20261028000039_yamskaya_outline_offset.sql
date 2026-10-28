-- «Ямская слобода»: the OSM footprints lie ≈ 10 m north of the buildings on the Yandex basemap (owner's
-- screenshot, 2026-10-28; measured on houses 12, 14 and 18 — 12–14 px at ≈ 0.75 m/px, the scale taken from
-- house 12, 49 m long in OSM). Around the bay they match, so it is OSM's local tracing offset, not the map.
-- The footprints of the quarter and the points of their game buildings move 10 m south (0.00009° of
-- latitude). The places' points (area_places) already sit on the basemap and stay.
-- A new osm:import of Zavidovo would bring the offset back: run this again after it.

-- the quarter: the hotel complex, the restaurant «СырЗавод» and the cottages by the pond
create temporary table yamskaya_box as
select extensions.st_makeenvelope(36.529, 56.5935, 36.540, 56.5985, 4326) as box;

update public.buildings b
   set location = extensions.st_translate(b.location::extensions.geometry, 0, -0.00009)::extensions.geography
  from public.osm_buildings o, yamskaya_box y
 where b.osm_building_id = o.id
   and extensions.st_covers(y.box, o.centroid);

update public.osm_buildings o
   set geom = extensions.st_translate(o.geom, 0, -0.00009),
       centroid = extensions.st_translate(o.centroid, 0, -0.00009)
  from yamskaya_box y
 where extensions.st_covers(y.box, o.centroid);

drop table yamskaya_box;
