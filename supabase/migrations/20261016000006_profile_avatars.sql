-- Player avatars: a picture uploaded by the player to Supabase Storage, same scheme as clan avatars.
-- Objects live at profile-avatars/<user id>/<random uuid>.<webp|jpg>; the client re-encodes the
-- picture to a 512×512 square before upload (which also strips EXIF/GPS metadata).
-- Only the player may upload/delete inside their own folder; profiles.avatar_path points to the
-- current file via set_profile_avatar(), which checks the folder and that the object exists.
-- No moderation yet: any uploaded picture is visible to all players (see PROJECT_STATUS).

-- avatar_url accepted any https URL written directly by the client: other players' devices would
-- load it (IP/tracking leak) and it was never set by the app. Replaced by a path in our own bucket.
revoke update (avatar_url) on public.profiles from authenticated;
alter table public.profiles drop column avatar_url;

alter table public.profiles
  add column avatar_path text
    check (avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg)$');

-- public read (served from the CDN), small files, re-encoded formats only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', true, 524288, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- no UPDATE policy: every upload gets a fresh name, so files are never overwritten in place
create policy profile_avatars_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- Storage needs SELECT as well as DELETE to remove an object
create policy profile_avatars_own_select on storage.objects for select to authenticated
  using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy profile_avatars_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Points the caller's profile at an uploaded file (or clears it with null).
-- Returns the previous path so the client can delete the old file.
create or replace function public.set_profile_avatar(p_path text)
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
  select avatar_path into v_old from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_path is not null then
    if p_path !~ ('^' || v_uid::text || '/[0-9a-f-]{36}\.(webp|jpg)$') then
      raise exception 'invalid_avatar' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'profile-avatars' and name = p_path) then
      raise exception 'invalid_avatar' using errcode = '22023';
    end if;
  end if;

  update public.profiles set avatar_path = p_path where id = v_uid;
  return v_old;
end;
$$;

revoke execute on function public.set_profile_avatar(text) from public, anon;
grant execute on function public.set_profile_avatar(text) to authenticated;
