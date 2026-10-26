-- Player events (mockups 123/ивенты, 2026-10-23): a player creates an event in 4 steps
-- (type → meeting point on the map → date, time and limit → title, description, cover),
-- other players sign up. All writes go through the functions below; tables are read-only for clients.
--
--   * kind        — run | walk | reading | cleanup (step 1 of the wizard).
--   * place_name  — derived on the server: address of the nearest OSM building within 200 m, else null.
--   * cover       — optional picture in the public bucket event-covers/<creator id>/<uuid>.<webp|jpg>,
--                   re-encoded by the client (EXIF/GPS stripped). No moderation yet (see PROJECT_STATUS).
--   * participants — the creator is the first participant and cannot leave; the limit counts the creator.

create table public.events (
  id               uuid primary key default gen_random_uuid(),
  creator_id       uuid not null references public.profiles (id) on delete cascade,
  kind             text not null check (kind in ('run', 'walk', 'reading', 'cleanup')),
  title            text not null check (char_length(btrim(title)) between 3 and 80),
  description      text check (char_length(description) <= 500),
  location         extensions.geography(Point, 4326) not null,
  place_name       text check (char_length(place_name) <= 160),
  starts_at        timestamptz not null,
  max_participants integer not null check (max_participants between 2 and 100),
  cover_path       text check (cover_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg)$'),
  created_at       timestamptz not null default now()
);
create index events_starts_at_idx on public.events (starts_at);
create index events_creator_idx on public.events (creator_id, starts_at);

create table public.event_participants (
  event_id  uuid not null references public.events (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index event_participants_user_idx on public.event_participants (user_id);

alter table public.events enable row level security;
alter table public.event_participants enable row level security;
revoke all on public.events, public.event_participants from anon, authenticated;
grant select on public.events, public.event_participants to authenticated;
-- events are public game content, like clans
create policy events_read on public.events for select to authenticated using (true);
create policy event_participants_read on public.event_participants for select to authenticated using (true);

-- public read (served from the CDN), re-encoded formats only, ≤1.5 MB (prepareMemoryPhoto)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-covers', 'event-covers', true, 1572864, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- no UPDATE policy: every upload gets a fresh name
create policy event_covers_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'event-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- Storage needs SELECT as well as DELETE to remove an object
create policy event_covers_own_select on storage.objects for select to authenticated
  using (bucket_id = 'event-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy event_covers_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'event-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- create_event: validates everything, derives the place name, signs the creator up
-- ---------------------------------------------------------------------------
create or replace function public.create_event(
  p_kind text,
  p_title text,
  p_description text,
  p_lat double precision,
  p_lng double precision,
  p_starts_at timestamptz,
  p_max_participants integer,
  p_cover_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- at least this far ahead, so others can still sign up
  c_min_lead constant interval := interval '15 minutes';
  c_max_lead constant interval := interval '90 days';
  -- upcoming events one player may have at once (spam guard)
  c_max_upcoming constant integer := 5;
  c_place_radius_m constant integer := 200;
  v_uid uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_point extensions.geography;
  v_place text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('run', 'walk', 'reading', 'cleanup')
     or char_length(v_title) not between 3 and 80
     or char_length(coalesce(v_description, '')) > 500
     or p_max_participants is null or p_max_participants not between 2 and 100
     or p_starts_at is null or p_starts_at < now() + c_min_lead or p_starts_at > now() + c_max_lead then
    raise exception 'invalid_event' using errcode = '22023';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid_location' using errcode = '22023';
  end if;
  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
  -- the game is about Moscow: the meeting point must be inside an okrug
  if not exists (select 1 from public.districts d where extensions.st_covers(d.boundary, v_point)) then
    raise exception 'invalid_location' using errcode = '22023';
  end if;
  if p_cover_path is not null
     and (p_cover_path !~ ('^' || v_uid::text || '/[0-9a-f-]{36}\.(webp|jpg)$')
          or not exists (select 1 from storage.objects where bucket_id = 'event-covers' and name = p_cover_path)) then
    raise exception 'invalid_photo' using errcode = '22023';
  end if;

  -- serialize one player's creations so the limit cannot be raced
  perform 1 from public.profiles where id = v_uid for update;
  if (select count(*) from public.events where creator_id = v_uid and starts_at > now()) >= c_max_upcoming then
    raise exception 'too_many_events' using errcode = 'P0001';
  end if;

  select nullif(btrim(b.address), '') into v_place
  from public.osm_buildings b
  where b.address is not null
    and extensions.st_dwithin(b.centroid::extensions.geography, v_point, c_place_radius_m)
  order by b.centroid operator(extensions.<->) v_point::extensions.geometry
  limit 1;

  insert into public.events (creator_id, kind, title, description, location, place_name, starts_at, max_participants, cover_path)
  values (v_uid, p_kind, v_title, v_description, v_point, left(v_place, 160), p_starts_at, p_max_participants, p_cover_path)
  returning id into v_id;
  insert into public.event_participants (event_id, user_id) values (v_id, v_uid);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- join / leave
-- ---------------------------------------------------------------------------
create or replace function public.join_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_event public.events%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  -- the row lock serializes sign-ups, so the limit cannot be exceeded
  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.event_participants where event_id = p_event_id and user_id = v_uid) then
    return; -- already signed up
  end if;
  if v_event.starts_at <= now() then
    raise exception 'event_started' using errcode = 'P0001';
  end if;
  if (select count(*) from public.event_participants where event_id = p_event_id) >= v_event.max_participants then
    raise exception 'event_full' using errcode = 'P0001';
  end if;
  insert into public.event_participants (event_id, user_id) values (p_event_id, v_uid);
end;
$$;

create or replace function public.leave_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_event public.events%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0001';
  end if;
  if v_event.creator_id = v_uid then
    raise exception 'event_creator' using errcode = 'P0001';
  end if;
  if v_event.starts_at <= now() then
    raise exception 'event_started' using errcode = 'P0001';
  end if;
  delete from public.event_participants where event_id = p_event_id and user_id = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- reads: the feed (upcoming and running) and one event
-- ---------------------------------------------------------------------------
-- one event as the client sees it; p_faces — how many participants to include (in joining order)
create or replace function public._event_json(p_event public.events, p_uid uuid, p_faces integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_event.id,
    'kind', p_event.kind,
    'title', p_event.title,
    'description', p_event.description,
    'lat', extensions.st_y(p_event.location::extensions.geometry),
    'lng', extensions.st_x(p_event.location::extensions.geometry),
    'placeName', p_event.place_name,
    'startsAt', p_event.starts_at,
    'maxParticipants', p_event.max_participants,
    'coverPath', p_event.cover_path,
    'participants', (select count(*) from public.event_participants ep where ep.event_id = p_event.id),
    'joined', exists (select 1 from public.event_participants ep where ep.event_id = p_event.id and ep.user_id = p_uid),
    'organizer', (
      select jsonb_build_object('userId', p.id, 'username', p.username, 'avatarPath', p.avatar_path, 'avatarKey', p.avatar_key)
      from public.profiles p where p.id = p_event.creator_id
    ),
    'faces', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'userId', f.id, 'username', f.username, 'avatarPath', f.avatar_path, 'avatarKey', f.avatar_key
             ) order by f.joined_at), '[]'::jsonb)
      from (
        select p.id, p.username, p.avatar_path, p.avatar_key, ep.joined_at
        from public.event_participants ep
        join public.profiles p on p.id = ep.user_id
        where ep.event_id = p_event.id
        order by ep.joined_at
        limit p_faces
      ) f
    )
  );
$$;
revoke execute on function public._event_json(public.events, uuid, integer) from public, anon, authenticated;

create or replace function public.events_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_limit constant integer := 50;
  v_uid uuid := auth.uid();
begin
  -- an event stays listed until 3 hours after its start
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(public._event_json(e, v_uid, 4) order by e.starts_at), '[]'::jsonb)
    from (
      select * from public.events
      where starts_at > now() - interval '3 hours'
      order by starts_at
      limit c_limit
    ) e
  );
end;
$$;

create or replace function public.event_page(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_event public.events%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0001';
  end if;
  return public._event_json(v_event, v_uid, 8);
end;
$$;

revoke execute on function public.create_event(text, text, text, double precision, double precision, timestamptz, integer, text) from public, anon, authenticated;
grant execute on function public.create_event(text, text, text, double precision, double precision, timestamptz, integer, text) to authenticated;
revoke execute on function public.join_event(uuid) from public, anon, authenticated;
grant execute on function public.join_event(uuid) to authenticated;
revoke execute on function public.leave_event(uuid) from public, anon, authenticated;
grant execute on function public.leave_event(uuid) to authenticated;
revoke execute on function public.events_feed() from public, anon, authenticated;
grant execute on function public.events_feed() to authenticated;
revoke execute on function public.event_page(uuid) from public, anon, authenticated;
grant execute on function public.event_page(uuid) to authenticated;
