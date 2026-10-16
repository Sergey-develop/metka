/**
 * Runs the real migrations on PostgreSQL (PGlite, WASM) with PostGIS and pgvector.
 * Supabase-specific pieces (roles, auth schema, default grants) are emulated
 * the way Supabase sets them up, so RLS and privilege checks are meaningful.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PGlite, type Transaction } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { postgis } from '@electric-sql/pglite-postgis'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const root = resolve(import.meta.dirname, '../..')

const SUPABASE_BOOTSTRAP = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase default privileges on public
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- minimal Supabase Storage: the tables and helper that policies refer to
create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
`

export interface TestDb {
  db: PGlite
  createUser: (id: string, username?: string) => Promise<void>
  asUser: <T>(userId: string | null, fn: (tx: Transaction) => Promise<T>) => Promise<T>
}

export async function createTestDb(options: { seed?: boolean } = {}): Promise<TestDb> {
  const db = await PGlite.create({ extensions: { vector, postgis, pgcrypto } })
  await db.exec(SUPABASE_BOOTSTRAP)

  const migrationsDir = join(root, 'supabase/migrations')
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'))
  }
  if (options.seed) {
    await db.exec(readFileSync(join(root, 'supabase/seed.sql'), 'utf8'))
  }
  // grant extension functions to client roles (Supabase does this on install)
  await db.exec(`grant execute on all functions in schema extensions to anon, authenticated, service_role;`)

  return {
    db,
    async createUser(id, username) {
      await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
        id,
        `${id}@test.local`,
        username ? { username } : {},
      ])
    },
    async asUser(userId, fn) {
      return db.transaction(async (tx) => {
        await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`)
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify(userId ? { sub: userId, role: 'authenticated' } : { role: 'anon' }),
        ])
        return fn(tx)
      })
    },
  }
}

/** Mock-model embedding for seed building N (basis vector e_N plus small off-axis noise). */
export function mockEmbedding(buildingIndex: number, noise = 0.08): number[] {
  return Array.from({ length: 16 }, (_, i) => (i + 1 === buildingIndex ? 1 : noise * (((i * 7) % 5) / 4)))
}

export const SEED = {
  districtCao: '00000000-0000-4000-a000-000000000001',
  bolshoi: { id: '00000000-0000-4000-b000-000000000001', index: 1, lat: 55.7601, lng: 37.6186 },
  gum: { id: '00000000-0000-4000-b000-000000000002', index: 2, lat: 55.7547, lng: 37.6215 },
  historical: { id: '00000000-0000-4000-b000-000000000003', index: 3, lat: 55.7553, lng: 37.6178 },
  tsum: { id: '00000000-0000-4000-b000-000000000005', index: 5, lat: 55.7612, lng: 37.6205 },
  questFirst: '00000000-0000-4000-c000-000000000001',
  questExplorer: '00000000-0000-4000-c000-000000000002',
} as const
