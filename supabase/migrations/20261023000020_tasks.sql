-- Map tasks (mockup «выдвигаются задания», 2026-10-23): tasks of the day (reset at Moscow midnight),
-- the task of the week (Moscow week, Monday to Monday) and the seasonal task.
--
--   * Progress is never stored: it is counted from existing tables for the current period, so it
--     cannot be inflated by the client and needs no reset job.
--   * The reward (coins) is claimed once per task and period: task_claims has one row per
--     (player, task, period start) and is written only by claim_task().
--   * Seasonal task = the active server quest with an end date that ends soonest (quests table);
--     it keeps its own progress and claim (claim_quest_reward).
--   * Mockup tasks without data were replaced: «собери 3 км» → explored cells (≈295 per km),
--     «здание в стиле модерн» → a rare (or rarer) building; there are no architectural styles yet.

create table public.tasks (
  slug         text primary key check (slug ~ '^[a-z0-9-]{2,64}$'),
  period       text not null check (period in ('day', 'week')),
  kind         text not null check (kind in ('discover', 'cells', 'rare', 'memory', 'districts')),
  title        text not null check (char_length(title) between 3 and 120),
  target       integer not null check (target between 1 and 100000),
  reward_coins integer not null check (reward_coins between 0 and 10000),
  sort         integer not null default 0,
  is_active    boolean not null default true
);

create table public.task_claims (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  task_slug    text not null references public.tasks (slug) on delete cascade,
  period_start date not null,
  coins        integer not null check (coins >= 0),
  claimed_at   timestamptz not null default now(),
  primary key (user_id, task_slug, period_start)
);

alter table public.tasks enable row level security;
alter table public.task_claims enable row level security;
revoke all on public.tasks, public.task_claims from anon, authenticated;
grant select on public.tasks, public.task_claims to authenticated;
create policy tasks_read on public.tasks for select to authenticated using (is_active);
create policy task_claims_read_own on public.task_claims for select to authenticated using (user_id = (select auth.uid()));

insert into public.tasks (slug, period, kind, title, target, reward_coins, sort) values
  ('day-discover', 'day', 'discover', 'Найди и отметь 2 новых объекта', 2, 50, 1),
  ('day-cells', 'day', 'cells', 'Прогуляйся и открой 300 клеток карты (≈1 км)', 300, 50, 2),
  ('day-rare', 'day', 'rare', 'Открой редкое здание', 1, 50, 3),
  ('day-memory', 'day', 'memory', 'Сохрани воспоминание о месте', 1, 50, 4),
  ('week-districts', 'week', 'districts', 'Исследуй 3 разных округа', 3, 300, 1)
on conflict (slug) do nothing;

-- start of the current period (a Moscow date) and its bounds as instants
create or replace function public._task_period(p_period text, out period_start date, out starts timestamptz, out ends timestamptz)
language sql
stable
set search_path = ''
as $$
  with d as (
    select case when p_period = 'week'
                then date_trunc('week', (now() at time zone 'Europe/Moscow'))::date
                else (now() at time zone 'Europe/Moscow')::date end as day
  )
  select d.day,
         d.day::timestamp at time zone 'Europe/Moscow',
         (d.day + case when p_period = 'week' then 7 else 1 end)::timestamp at time zone 'Europe/Moscow'
  from d;
$$;

-- the player's progress on one task kind between two instants, counted from the game tables
create or replace function public._task_progress(p_uid uuid, p_kind text, p_from timestamptz, p_to timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'discover' then (
      select count(*) from public.player_buildings
      where user_id = p_uid and discovered_at >= p_from and discovered_at < p_to)
    when 'rare' then (
      select count(*) from public.player_buildings pb
      join public.buildings b on b.id = pb.building_id
      where pb.user_id = p_uid and pb.discovered_at >= p_from and pb.discovered_at < p_to
        and b.rarity in ('rare', 'epic', 'legendary'))
    when 'cells' then (
      select count(*) from public.explored_cells
      where user_id = p_uid and explored_at >= p_from and explored_at < p_to)
    when 'memory' then (
      select count(*) from public.memories
      where user_id = p_uid and created_at >= p_from and created_at < p_to)
    when 'districts' then (
      select count(distinct d.id)
      from public.explored_cells c
      join public.districts d
        on extensions.st_covers(d.boundary,
             extensions.st_setsrid(extensions.st_makepoint(
               (c.cell_x + 0.5) * 0.00018 - 180, (c.cell_y + 0.5) * 0.0001 - 90), 4326)::extensions.geography)
      where c.user_id = p_uid and c.explored_at >= p_from and c.explored_at < p_to)
    else 0
  end::integer;
$$;

revoke execute on function public._task_period(text) from public, anon, authenticated;
revoke execute on function public._task_progress(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- my_tasks: everything the tasks sheet shows
-- ---------------------------------------------------------------------------
create or replace function public.my_tasks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_day record;
  v_week record;
  v_season jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_day from public._task_period('day');
  select * into v_week from public._task_period('week');

  select jsonb_build_object(
           'id', q.id,
           'title', q.title,
           'description', q.description,
           'target', q.target,
           'progress', least(coalesce(pq.progress, 0), q.target),
           'rewardCoins', q.reward_coins,
           'endsAt', q.ends_at,
           'completed', pq.completed_at is not null,
           'claimed', pq.claimed_at is not null
         )
    into v_season
  from public.quests q
  left join public.player_quests pq on pq.quest_id = q.id and pq.user_id = v_uid
  where q.is_active and q.ends_at is not null and q.ends_at > now()
  order by q.ends_at, q.id
  limit 1;

  return jsonb_build_object(
    'day', jsonb_build_object('start', v_day.period_start, 'endsAt', v_day.ends),
    'week', jsonb_build_object('start', v_week.period_start, 'endsAt', v_week.ends),
    'tasks', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'slug', t.slug,
               'period', t.period,
               'kind', t.kind,
               'title', t.title,
               'target', t.target,
               'progress', least(t.progress, t.target),
               'rewardCoins', t.reward_coins,
               'claimed', t.claimed
             ) order by t.period, t.sort), '[]'::jsonb)
      from (
        select tk.*,
               public._task_progress(v_uid, tk.kind,
                 case tk.period when 'week' then v_week.starts else v_day.starts end,
                 case tk.period when 'week' then v_week.ends else v_day.ends end) as progress,
               exists (
                 select 1 from public.task_claims c
                 where c.user_id = v_uid and c.task_slug = tk.slug
                   and c.period_start = case tk.period when 'week' then v_week.period_start else v_day.period_start end
               ) as claimed
        from public.tasks tk
        where tk.is_active
      ) t
    ),
    'season', v_season
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_task: coins for a completed task, once per period
-- ---------------------------------------------------------------------------
create or replace function public.claim_task(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks%rowtype;
  v_period record;
  v_inserted boolean;
  v_coins integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_task from public.tasks where slug = p_slug and is_active;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0001';
  end if;
  select * into v_period from public._task_period(v_task.period);
  if public._task_progress(v_uid, v_task.kind, v_period.starts, v_period.ends) < v_task.target then
    raise exception 'task_not_completed' using errcode = 'P0001';
  end if;

  insert into public.task_claims (user_id, task_slug, period_start, coins)
  values (v_uid, v_task.slug, v_period.period_start, v_task.reward_coins)
  on conflict do nothing
  returning true into v_inserted;

  if v_inserted then
    update public.profiles set coins = coins + v_task.reward_coins where id = v_uid
    returning coins into v_coins;
    return jsonb_build_object('status', 'claimed', 'coins', v_coins, 'reward', v_task.reward_coins);
  end if;
  select coins into v_coins from public.profiles where id = v_uid;
  return jsonb_build_object('status', 'already_claimed', 'coins', v_coins, 'reward', 0);
end;
$$;

revoke execute on function public.my_tasks() from public, anon, authenticated;
grant execute on function public.my_tasks() to authenticated;
revoke execute on function public.claim_task(text) from public, anon, authenticated;
grant execute on function public.claim_task(text) to authenticated;
