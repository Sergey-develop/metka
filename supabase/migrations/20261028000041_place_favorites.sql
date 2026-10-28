-- The heart on the place cards (owner, 2026-10-28: «у локаций пропала возможность сохранять в
-- избранное»). The heart of game buildings lives in memories (save_memory), which needs the building
-- discovered; the places of a game area (area_places — Zavidovo's cards) are not buildings and may be
-- saved before a visit. A player reads, adds and removes only their own hearts.

create table public.place_favorites (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  place_id   text not null references public.area_places (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

alter table public.place_favorites enable row level security;
revoke all on public.place_favorites from anon, authenticated;
grant select, insert, delete on public.place_favorites to authenticated;

create policy place_favorites_read_own on public.place_favorites for select to authenticated
  using (user_id = (select auth.uid()));
create policy place_favorites_add_own on public.place_favorites for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy place_favorites_remove_own on public.place_favorites for delete to authenticated
  using (user_id = (select auth.uid()));
