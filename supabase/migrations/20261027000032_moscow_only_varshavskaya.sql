-- Moscow is trimmed to the Varshavskaya quarter (owner's decision, 2026-10-27): every published game
-- building in the Moscow game area outside it — the 10 dev-seed landmarks of the centre and anything
-- else — is hidden. The quarter is the bbox of the OSM import (tools/osm-import/fetch-overpass.ts).
--
-- Hidden, not deleted: a delete would cascade to the players' discoveries (player_buildings), memories
-- and recognition embeddings. Hidden buildings are not on the map or in the lists (migration 007).
--
-- To bring them back:
--   update public.buildings set publish_status = 'published' where publish_status = 'hidden'
--     and st_y(location::geometry) between 55.1 and 56.2 and st_x(location::geometry) between 36.8 and 38.4;
-- (that also brings back anything hidden in Moscow before — there was nothing as of this migration)

update public.buildings b
   set publish_status = 'hidden'
 where b.publish_status in ('published', 'unavailable')
   -- the Moscow game area (in_game_area, migration 022)
   and extensions.st_y(b.location::extensions.geometry) between 55.1 and 56.2
   and extensions.st_x(b.location::extensions.geometry) between 36.8 and 38.4
   -- outside the Varshavskaya quarter
   and not (extensions.st_y(b.location::extensions.geometry) between 55.641 and 55.666
            and extensions.st_x(b.location::extensions.geometry) between 37.600 and 37.640);
