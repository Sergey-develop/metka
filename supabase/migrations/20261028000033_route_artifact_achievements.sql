-- Achievements for the Zavidovo quests (2026-10-28): until now the achievements (quests) only counted
-- buildings opened by a scan (_advance_quests, migration 002), so finishing a quest route or collecting
-- its artifacts gave none.
--
--   * two new kinds: route_count (quest routes completed, player_routes) and artifact_count (artifacts
--     earned, player_artifacts — from route steps and place check-ins);
--   * progress is the player's count itself, set by triggers on those tables, so it cannot drift and
--     needs no client: whatever function completes a route or gives an artifact moves it;
--   * players who already finished routes or collected artifacts get the progress now (backfill);
--   * the reward is claimed as for any achievement (claim_quest_reward).

alter table public.quests drop constraint quests_kind_check;
alter table public.quests add constraint quests_kind_check
  check (kind in ('discover_count', 'discover_in_district', 'discover_rarity', 'route_count', 'artifact_count'));

insert into public.quests (slug, title, description, kind, target, reward_xp, reward_coins) values
  ('zav-first-route', 'Первый маршрут', 'Пройдите любой маршрут Завидово до финала.', 'route_count', 1, 100, 50),
  ('zav-two-routes', 'Знаток Завидово', 'Пройдите два маршрута Завидово.', 'route_count', 2, 200, 100),
  ('zav-collector', 'Коллекционер', 'Соберите 5 артефактов Завидово.', 'artifact_count', 5, 150, 50)
on conflict (slug) do nothing;

-- the player's active achievements of a counted kind, set to the count (completed once it reaches the target)
create or replace function public._sync_count_quests(p_user_id uuid, p_kind text, p_count integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_count <= 0 then
    return;
  end if;
  insert into public.player_quests as pq (user_id, quest_id, progress, completed_at)
  select p_user_id, q.id, least(p_count, q.target), case when p_count >= q.target then now() end
    from public.quests q
   where q.kind = p_kind
     and q.is_active
     and (q.starts_at is null or q.starts_at <= now())
     and (q.ends_at is null or q.ends_at > now())
  on conflict (user_id, quest_id) do update
    set progress = excluded.progress,
        completed_at = excluded.completed_at
    where pq.completed_at is null;
end;
$$;
revoke execute on function public._sync_count_quests(uuid, text, integer) from public, anon, authenticated;

create or replace function public._route_count_quests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._sync_count_quests(new.user_id, 'route_count',
    (select count(*)::integer from public.player_routes where user_id = new.user_id));
  return null;
end;
$$;
revoke execute on function public._route_count_quests() from public, anon, authenticated;

create or replace function public._artifact_count_quests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._sync_count_quests(new.user_id, 'artifact_count',
    (select count(*)::integer from public.player_artifacts where user_id = new.user_id));
  return null;
end;
$$;
revoke execute on function public._artifact_count_quests() from public, anon, authenticated;

drop trigger if exists player_routes_quests on public.player_routes;
create trigger player_routes_quests
  after insert on public.player_routes
  for each row execute function public._route_count_quests();

drop trigger if exists player_artifacts_quests on public.player_artifacts;
create trigger player_artifacts_quests
  after insert on public.player_artifacts
  for each row execute function public._artifact_count_quests();

-- backfill: routes finished and artifacts collected before this migration
select public._sync_count_quests(r.user_id, 'route_count', r.n)
  from (select user_id, count(*)::integer n from public.player_routes group by user_id) r;
select public._sync_count_quests(a.user_id, 'artifact_count', a.n)
  from (select user_id, count(*)::integer n from public.player_artifacts group by user_id) a;
