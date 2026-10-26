-- Catalog photos of game buildings (buildings.image_url points here).
-- Public read: the photos are catalog content, shown to every player.
-- No insert/update/delete policies: only the service role (catalog tooling) writes,
-- players and admins in the client cannot upload here.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('building-photos', 'building-photos', true, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
