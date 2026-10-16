-- Clan avatars: an image uploaded by the clan owner to Supabase Storage.
-- Objects live at clan-avatars/<clan id>/<random uuid>.<webp|jpg>; the client re-encodes
-- the picture to a 512×512 square before upload (which also strips EXIF/GPS metadata).
-- Only the owner may upload/delete inside their clan's folder; the clan row points to
-- the current file via set_clan_avatar(), which checks ownership and that the object exists.
-- No moderation yet: any owner-uploaded picture is visible to all players (see PROJECT_STATUS).

alter table public.clans
  add column avatar_path text
    check (avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg)$');

-- public read (served from the CDN), small files, re-encoded formats only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clan-avatars', 'clan-avatars', true, 524288, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- folder name (first path segment) → is the caller the owner of that clan?
create or replace function public.is_clan_owner(p_clan_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clans c
     where c.id::text = p_clan_id
       and c.owner_id = (select auth.uid())
  );
$$;

-- no UPDATE policy: every upload gets a fresh name, so files are never overwritten in place
create policy clan_avatars_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'clan-avatars' and public.is_clan_owner((storage.foldername(name))[1]));
-- Storage needs SELECT as well as DELETE to remove an object
create policy clan_avatars_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'clan-avatars' and public.is_clan_owner((storage.foldername(name))[1]));
create policy clan_avatars_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'clan-avatars' and public.is_clan_owner((storage.foldername(name))[1]));

-- Points the caller's clan at an uploaded file (or clears it with null).
-- Returns the previous path so the client can delete the old file.
create or replace function public.set_clan_avatar(p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_clan public.clans%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_clan from public.clans where owner_id = v_uid for update;
  if not found then
    raise exception 'not_clan_owner' using errcode = 'P0001';
  end if;
  if p_path is not null then
    if p_path !~ ('^' || v_clan.id::text || '/[0-9a-f-]{36}\.(webp|jpg)$') then
      raise exception 'invalid_avatar' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'clan-avatars' and name = p_path) then
      raise exception 'invalid_avatar' using errcode = '22023';
    end if;
  end if;

  update public.clans set avatar_path = p_path where id = v_clan.id;
  return v_clan.avatar_path;
end;
$$;

-- leaderboard now also returns the avatar (return type changes → drop and recreate)
drop function public.clan_leaderboard(uuid, integer);
create function public.clan_leaderboard(p_district_id uuid default null, p_limit integer default 20)
returns table (clan_id uuid, name text, tag text, avatar_path text, members integer, points bigint, rank bigint)
language sql
stable
set search_path = ''
as $$
  select c.id, c.name, c.tag, c.avatar_path,
         (select count(*)::integer from public.clan_members m2 where m2.clan_id = c.id),
         coalesce(sum(pi.points), 0)::bigint as points,
         rank() over (order by coalesce(sum(pi.points), 0) desc)
  from public.clans c
  join public.clan_members m on m.clan_id = c.id
  left join public.player_influence pi
    on pi.user_id = m.user_id
   and (p_district_id is null or pi.district_id = p_district_id)
  group by c.id, c.name, c.tag, c.avatar_path
  order by points desc, c.name
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

revoke execute on function public.is_clan_owner(text) from public, anon;
grant execute on function public.is_clan_owner(text) to authenticated;
revoke execute on function public.set_clan_avatar(text) from public, anon;
grant execute on function public.set_clan_avatar(text) to authenticated;
revoke execute on function public.clan_leaderboard(uuid, integer) from public, anon;
grant execute on function public.clan_leaderboard(uuid, integer) to authenticated;
