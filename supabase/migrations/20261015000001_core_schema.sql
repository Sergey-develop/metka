-- METKA core schema: profiles, catalog, districts, scans, collection, rewards,
-- quests, influence, clans. Game-critical writes go only through SECURITY
-- DEFINER functions (see 20261015000002_game_functions.sql).

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- districts (MVP: a district is the territory unit for influence)
-- ---------------------------------------------------------------------------
create table public.districts (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,64}$'),
  name        text not null check (char_length(name) between 1 and 120),
  short_name  text not null check (char_length(short_name) between 1 and 16),
  city        text not null,
  boundary    extensions.geography(MultiPolygon, 4326) not null,
  is_dev_seed boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index districts_boundary_gix on public.districts using gist (boundary);
create trigger districts_updated_at before update on public.districts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  username             text not null unique check (username ~ '^[A-Za-z0-9_А-Яа-яЁё]{3,24}$'),
  avatar_url           text check (avatar_url is null or avatar_url ~ '^https://'),
  level                integer not null default 1 check (level >= 1),
  xp                   integer not null default 0 check (xp >= 0),
  coins                integer not null default 0 check (coins >= 0),
  buildings_discovered integer not null default 0 check (buildings_discovered >= 0),
  home_district_id     uuid references public.districts (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- building catalog
-- ---------------------------------------------------------------------------
create table public.buildings (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9-]{2,64}$'),
  name           text not null check (char_length(name) between 1 and 160),
  description    text,
  address        text,
  district_id    uuid references public.districts (id) on delete set null,
  location       extensions.geography(Point, 4326) not null,
  scan_radius_m  integer not null default 75 check (scan_radius_m between 20 and 500),
  rarity         text not null default 'common'
                   check (rarity in ('common', 'rare', 'epic', 'legendary')),
  reward_xp        integer not null default 50 check (reward_xp between 0 and 10000),
  reward_coins     integer not null default 10 check (reward_coins between 0 and 10000),
  reward_influence integer not null default 10 check (reward_influence between 0 and 10000),
  image_url      text,
  is_active      boolean not null default true,
  -- true for synthetic local-development data; never shown as verified catalog
  is_dev_seed    boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index buildings_location_gix on public.buildings using gist (location);
create index buildings_district_idx on public.buildings (district_id) where is_active;
create trigger buildings_updated_at before update on public.buildings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- recognition: model registry and reference embeddings (server-only)
-- ---------------------------------------------------------------------------
create table public.recognition_models (
  version          text primary key check (version ~ '^[a-z0-9._-]{1,64}$'),
  embedding_dim    integer not null check (embedding_dim between 2 and 4096),
  score_threshold  real not null check (score_threshold between 0 and 1),
  margin_threshold real not null check (margin_threshold between 0 and 1),
  -- a real photo never reproduces a reference embedding exactly; scores above
  -- this value indicate a replayed reference vector
  max_plausible_score real not null default 0.995 check (max_plausible_score between 0 and 1),
  is_active        boolean not null default false,
  created_at       timestamptz not null default now()
);

create table public.building_reference_embeddings (
  id            uuid primary key default gen_random_uuid(),
  building_id   uuid not null references public.buildings (id) on delete cascade,
  model_version text not null references public.recognition_models (version) on delete cascade,
  embedding     extensions.vector not null,
  source        text,
  created_at    timestamptz not null default now()
);
create index building_reference_embeddings_lookup
  on public.building_reference_embeddings (model_version, building_id);

create or replace function public.check_reference_embedding_dim()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_dim integer;
begin
  select embedding_dim into v_dim from public.recognition_models where version = new.model_version;
  if extensions.vector_dims(new.embedding) <> v_dim then
    raise exception 'embedding dimension % does not match model % (%)',
      extensions.vector_dims(new.embedding), new.model_version, v_dim;
  end if;
  return new;
end;
$$;
create trigger building_reference_embeddings_dim
  before insert or update on public.building_reference_embeddings
  for each row execute function public.check_reference_embedding_dim();

-- ---------------------------------------------------------------------------
-- scans: every attempt, accepted or not. Idempotent per (user, request id).
-- ---------------------------------------------------------------------------
create table public.building_scans (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  client_request_id  uuid not null,
  building_id        uuid references public.buildings (id) on delete set null,
  status             text not null default 'processing'
                       check (status in ('processing', 'accepted', 'rejected', 'already_discovered')),
  reject_reason      text,
  player_location    extensions.geography(Point, 4326),
  accuracy_m         real,
  distance_m         real,
  model_version      text,
  target_score       real,
  best_other_score   real,
  best_other_building_id uuid,
  image_sha256       text check (image_sha256 is null or image_sha256 ~ '^[0-9a-f]{64}$'),
  quality            jsonb,
  result             jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, client_request_id)
);
create index building_scans_user_time_idx on public.building_scans (user_id, created_at desc);
create index building_scans_image_idx on public.building_scans (image_sha256)
  where status = 'accepted' and image_sha256 is not null;
create trigger building_scans_updated_at before update on public.building_scans
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- collection
-- ---------------------------------------------------------------------------
create table public.player_buildings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  building_id   uuid not null references public.buildings (id) on delete cascade,
  scan_id       uuid not null references public.building_scans (id),
  discovered_at timestamptz not null default now(),
  unique (user_id, building_id)
);
create index player_buildings_user_idx on public.player_buildings (user_id, discovered_at desc);

-- ---------------------------------------------------------------------------
-- reward ledger: one row per granted reward; UNIQUE prevents double grants
-- ---------------------------------------------------------------------------
create table public.reward_ledger (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  source_type text not null check (source_type in ('building_discovery', 'quest')),
  source_id   uuid not null,
  xp          integer not null default 0 check (xp >= 0),
  coins       integer not null default 0 check (coins >= 0),
  influence   integer not null default 0 check (influence >= 0),
  district_id uuid references public.districts (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (user_id, source_type, source_id)
);

-- ---------------------------------------------------------------------------
-- quests
-- ---------------------------------------------------------------------------
create table public.quests (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9-]{2,64}$'),
  title        text not null,
  description  text not null,
  kind         text not null check (kind in ('discover_count', 'discover_in_district', 'discover_rarity')),
  target       integer not null check (target between 1 and 10000),
  district_id  uuid references public.districts (id) on delete cascade,
  rarity       text check (rarity in ('common', 'rare', 'epic', 'legendary')),
  reward_xp    integer not null default 0 check (reward_xp >= 0),
  reward_coins integer not null default 0 check (reward_coins >= 0),
  is_active    boolean not null default true,
  starts_at    timestamptz,
  ends_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (kind <> 'discover_in_district' or district_id is not null),
  check (kind <> 'discover_rarity' or rarity is not null)
);
create trigger quests_updated_at before update on public.quests
  for each row execute function public.set_updated_at();

create table public.player_quests (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  quest_id     uuid not null references public.quests (id) on delete cascade,
  progress     integer not null default 0 check (progress >= 0),
  completed_at timestamptz,
  claimed_at   timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, quest_id),
  check (claimed_at is null or completed_at is not null)
);
create trigger player_quests_updated_at before update on public.player_quests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- influence
-- ---------------------------------------------------------------------------
create table public.player_influence (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  district_id uuid not null references public.districts (id) on delete cascade,
  points      integer not null default 0 check (points >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, district_id)
);
create index player_influence_district_idx on public.player_influence (district_id, points desc);
create trigger player_influence_updated_at before update on public.player_influence
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- clans
-- ---------------------------------------------------------------------------
create table public.clans (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(btrim(name)) between 3 and 32),
  tag        text not null unique check (tag ~ '^[A-Z0-9А-ЯЁ]{2,5}$'),
  owner_id   uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger clans_updated_at before update on public.clans
  for each row execute function public.set_updated_at();

create table public.clan_members (
  clan_id   uuid not null references public.clans (id) on delete cascade,
  user_id   uuid not null unique references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (clan_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Row Level Security. Clients get read access only; every write to game
-- state goes through SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------
alter table public.districts                     enable row level security;
alter table public.profiles                      enable row level security;
alter table public.buildings                     enable row level security;
alter table public.recognition_models            enable row level security;
alter table public.building_reference_embeddings enable row level security;
alter table public.building_scans                enable row level security;
alter table public.player_buildings              enable row level security;
alter table public.reward_ledger                 enable row level security;
alter table public.quests                        enable row level security;
alter table public.player_quests                 enable row level security;
alter table public.player_influence              enable row level security;
alter table public.clans                         enable row level security;
alter table public.clan_members                  enable row level security;

-- Defense in depth: remove Supabase's default table grants for client roles,
-- then grant back only what is needed.
revoke all on all tables in schema public from anon, authenticated;

grant select on public.districts, public.buildings, public.quests,
  public.profiles, public.player_influence, public.clans, public.clan_members
  to authenticated;
grant select on public.building_scans, public.player_buildings,
  public.reward_ledger, public.player_quests
  to authenticated;
-- profile: only cosmetic columns are client-editable
grant update (username, avatar_url, home_district_id) on public.profiles to authenticated;

create policy districts_read on public.districts for select to authenticated using (true);
create policy buildings_read on public.buildings for select to authenticated using (is_active);
create policy quests_read on public.quests for select to authenticated using (is_active);

-- public game profile (no email or other PII lives in this table)
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy scans_read_own on public.building_scans for select to authenticated
  using (user_id = (select auth.uid()));
create policy player_buildings_read_own on public.player_buildings for select to authenticated
  using (user_id = (select auth.uid()));
create policy reward_ledger_read_own on public.reward_ledger for select to authenticated
  using (user_id = (select auth.uid()));
create policy player_quests_read_own on public.player_quests for select to authenticated
  using (user_id = (select auth.uid()));

-- influence and clans are public game state
create policy player_influence_read on public.player_influence for select to authenticated using (true);
create policy clans_read on public.clans for select to authenticated using (true);
create policy clan_members_read on public.clan_members for select to authenticated using (true);
-- recognition_models / building_reference_embeddings: no client policies.
