-- Reset ONE account's Zavidovo progress, so the demo quest can be walked again from the start.
-- Not a migration: run it by hand in Supabase → SQL Editor before a demo, with the demo account's email
-- in v_email below. Only that account is touched.
--
-- Removed: route steps done, routes finished, artifacts, place check-ins, their rewards in reward_ledger
-- (so the steps pay again) and the progress of the route / artifact achievements (migration 033), so
-- «Новое достижение» shows again. Kept: XP and coins already on the profile, scans, everything else.
-- After it, close and reopen the app (it keeps the quests loaded).

do $$
declare
  v_email text := 'demo@example.com'; -- ← the demo account
  v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(v_email);
  if v_uid is null then
    raise exception 'no account with email %', v_email;
  end if;

  delete from public.player_route_steps where user_id = v_uid;
  delete from public.player_routes where user_id = v_uid;
  delete from public.player_artifacts where user_id = v_uid;
  delete from public.player_places where user_id = v_uid;
  delete from public.reward_ledger where user_id = v_uid and source_type in ('route_step', 'route', 'place');
  delete from public.player_quests pq
   using public.quests q
   where pq.user_id = v_uid and q.id = pq.quest_id and q.kind in ('route_count', 'artifact_count');

  raise notice 'Zavidovo progress of % reset', v_email;
end;
$$;
