-- Album of memories + player progress.
--
-- Three separate things (never mixed):
--   explored_cells   — territory walked through (migration 008)
--   player_buildings — buildings unlocked by a scan (existing game logic)
--   memories         — the player's own note/photo/impression about an UNLOCKED building
-- A memory references the existing game building (no duplicate places) and belongs to one player.
-- MVP: one memory per player and building (saving again updates it).

create table public.memories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  building_id uuid not null references public.buildings (id) on delete cascade,
  note        text check (char_length(note) <= 2000),
  visited_on  date check (visited_on >= date '2000-01-01'),
  -- stickers: liked = blue, wow = pink, meh = black-and-white; is_favorite = heart
  impression  text check (impression in ('liked', 'wow', 'meh')),
  is_favorite boolean not null default false,
  -- private photo in memory-photos/<user id>/<uuid>.<webp|jpg>
  photo_path  text check (photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg)$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, building_id)
);
create index memories_user_idx on public.memories (user_id, updated_at desc);
create trigger memories_updated_at before update on public.memories
  for each row execute function public.set_updated_at();

alter table public.memories enable row level security;
revoke all on public.memories from anon, authenticated;
-- players read only their own memories; writes go through save_memory/delete_memory
grant select on public.memories to authenticated;
create policy memories_read_own on public.memories for select to authenticated
  using (user_id = (select auth.uid()));

-- Private photos: only the owner can upload, read (signed URLs) and delete in their own folder.
-- The client re-encodes photos before upload (strips EXIF, incl. GPS) — see utils/avatarImage.ts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('memory-photos', 'memory-photos', false, 1572864, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy memory_photos_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'memory-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy memory_photos_own_select on storage.objects for select to authenticated
  using (bucket_id = 'memory-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy memory_photos_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'memory-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- save / delete a memory
-- ---------------------------------------------------------------------------
-- Allowed only for a building the caller has unlocked. Returns {memory, previousPhotoPath}; the
-- client deletes the previous photo from Storage when it was replaced or removed.
create or replace function public.save_memory(
  p_building_id uuid,
  p_note text,
  p_visited_on date,
  p_impression text,
  p_is_favorite boolean,
  p_photo_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old text;
  v_row public.memories;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.player_buildings where user_id = v_uid and building_id = p_building_id) then
    raise exception 'building_locked' using errcode = 'P0001';
  end if;
  if p_visited_on is not null and p_visited_on > current_date + 1 then
    raise exception 'invalid_memory' using errcode = '22023';
  end if;
  if p_photo_path is not null then
    if p_photo_path !~ ('^' || v_uid::text || '/[0-9a-f-]{36}\.(webp|jpg)$')
       or not exists (select 1 from storage.objects where bucket_id = 'memory-photos' and name = p_photo_path) then
      raise exception 'invalid_photo' using errcode = '22023';
    end if;
  end if;

  select photo_path into v_old from public.memories where user_id = v_uid and building_id = p_building_id for update;

  insert into public.memories as m (user_id, building_id, note, visited_on, impression, is_favorite, photo_path)
  values (v_uid, p_building_id, nullif(btrim(p_note), ''), p_visited_on, p_impression, coalesce(p_is_favorite, false), p_photo_path)
  on conflict (user_id, building_id) do update
    set note = excluded.note, visited_on = excluded.visited_on, impression = excluded.impression,
        is_favorite = excluded.is_favorite, photo_path = excluded.photo_path
  returning * into v_row;

  return jsonb_build_object(
    'memory', to_jsonb(v_row) - 'user_id',
    'previousPhotoPath', case when v_old is distinct from p_photo_path then v_old end);
exception
  when check_violation then
    raise exception 'invalid_memory' using errcode = '22023';
end;
$$;

-- Returns the photo path to delete from Storage (or null).
create or replace function public.delete_memory(p_building_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_path text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  delete from public.memories where user_id = v_uid and building_id = p_building_id returning photo_path into v_path;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- progress: each number comes from its own table, so nothing is counted twice
-- ---------------------------------------------------------------------------
-- An okrug counts as explored once the player has ≥ 50 explored cells in it (~1 km of streets),
-- so crossing a border for a few steps does not count. Cells are assigned by their centre point.
create or replace function public.player_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_district_min_cells constant integer := 50;
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  with cell_districts as (
    select d.id as district_id, count(*) as cells
    from public.explored_cells c
    join public.districts d
      on extensions.st_covers(d.boundary,
           extensions.st_setsrid(extensions.st_makepoint(
             (c.cell_x + 0.5) * 0.00036 - 180, (c.cell_y + 0.5) * 0.0002 - 90), 4326)::extensions.geography)
    where c.user_id = v_uid
    group by d.id
  )
  select jsonb_build_object(
    'exploredCells', (select count(*) from public.explored_cells where user_id = v_uid),
    'exploredDistricts', (select count(*) from cell_districts where cells >= c_district_min_cells),
    'districtMinCells', c_district_min_cells,
    'unlockedBuildings', (select count(*) from public.player_buildings where user_id = v_uid),
    'memories', (select count(*) from public.memories where user_id = v_uid),
    'favoritePlaces', (select count(*) from public.memories where user_id = v_uid and is_favorite)
  ) into v_result;
  return v_result;
end;
$$;

revoke execute on function public.save_memory(uuid, text, date, text, boolean, text) from public, anon, authenticated;
revoke execute on function public.delete_memory(uuid) from public, anon, authenticated;
revoke execute on function public.player_progress() from public, anon, authenticated;
grant execute on function public.save_memory(uuid, text, date, text, boolean, text) to authenticated;
grant execute on function public.delete_memory(uuid) to authenticated;
grant execute on function public.player_progress() to authenticated;
