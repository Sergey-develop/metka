-- The player's own photo from the scan that unlocked a building, shown in the collection.
-- Until now only the photo's hash reached the server. The photo goes to the private bucket from
-- migration 010 (memory-photos/<user id>/…, owner-only, EXIF stripped by the client) and is linked
-- here. It is not a memory: the album stays a separate, explicit action.

alter table public.player_buildings
  add column photo_path text check (photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg)$');
-- players already read their own player_buildings rows (RLS); they still cannot write them

-- Links an uploaded photo to the caller's unlocked building. p_replace = false keeps an existing
-- photo (re-scan of an already discovered building). Returns the path the client should delete
-- from Storage: the replaced photo, or the new one when it was not used; null otherwise.
create or replace function public.set_discovery_photo(p_building_id uuid, p_photo_path text, p_replace boolean default true)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_photo_path is null
     or p_photo_path !~ ('^' || v_uid::text || '/[0-9a-f-]{36}\.(webp|jpg)$')
     or not exists (select 1 from storage.objects where bucket_id = 'memory-photos' and name = p_photo_path) then
    raise exception 'invalid_photo' using errcode = '22023';
  end if;

  select photo_path into v_old from public.player_buildings
   where user_id = v_uid and building_id = p_building_id for update;
  if not found then
    raise exception 'building_locked' using errcode = 'P0001';
  end if;
  if v_old is not null and not coalesce(p_replace, true) then
    return p_photo_path; -- keep the existing photo; the new upload is not needed
  end if;

  update public.player_buildings set photo_path = p_photo_path
   where user_id = v_uid and building_id = p_building_id;
  return v_old;
end;
$$;

revoke execute on function public.set_discovery_photo(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.set_discovery_photo(uuid, text, boolean) to authenticated;
