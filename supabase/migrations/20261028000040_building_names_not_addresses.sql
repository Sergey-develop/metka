-- Buildings go by their names only, never by a street address (owner, 2026-10-28: no «Тверской бульвар 4»).
-- Bulk publishing named a building without an OSM name after its address; migration 038 replaced those
-- next to a place or on the owner's screenshot. The rest called by an address (the building's own, the
-- OSM one, or anything shaped «street, number») get a generic name: «Здание курорта Завидово» in the
-- resort zone, «Здание» elsewhere. The address itself stays in the data; the app no longer shows it.

update public.buildings b
   set name = case
         when extensions.st_covers(z.boundary, b.location) then 'Здание курорта Завидово'
         else 'Здание'
       end
  from public.area_zones z
 where z.id = 'zavidovo-core'
   and b.slug like 'osm-%'
   and (
     b.name = b.address
     or b.name = (select o.address from public.osm_buildings o where o.id = b.osm_building_id)
     or b.name ~* '(улица|ул\.|бульвар|проезд|переулок|шоссе|проспект|набережная|площадь|пл\.)\s*,?\s*\d'
   );
