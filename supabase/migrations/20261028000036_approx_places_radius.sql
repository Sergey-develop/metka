-- The demo walk (2026-10-28): places whose point on the map is approximate (needs_check — set from a
-- screenshot, not checked on the ground) get a check-in radius of at least 150 m, as the bay and the
-- yacht club have. With 60 m (the pedestrian bridge, step 3 of «Поймай волну») a point placed a little
-- off said «до точки ещё …» while the player stood on the bridge. The server still adds the GPS error
-- (≤ 50 m) on top; precise places keep their radius.

update public.area_places
   set radius_m = 150
 where needs_check and is_active and radius_m < 150;
