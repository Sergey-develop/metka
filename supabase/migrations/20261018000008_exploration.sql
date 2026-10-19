-- Explored territory: grid cells the player has walked through with "Исследование" on.
-- Separate from discovered buildings (player_buildings). The client sends only GPS fixes; the
-- server derives cells itself and rejects implausible tracks, so progress cannot be posted directly.
--
-- Grid (same formula in src/services/exploration/grid.ts): fixed steps in degrees,
--   cell_y = floor((lat + 90) / 0.0002), cell_x = floor((lng + 180) / 0.00036)
-- ≈ 22 × 22 m at Moscow's latitude. Chosen over H3: no H3 extension is guaranteed on Supabase
-- or in the PGlite test database, and the server must be able to recompute cells to validate.

create table public.explored_cells (
  user_id     uuid not null references auth.users (id) on delete cascade,
  cell_y      integer not null check (cell_y between 0 and 900000),
  cell_x      integer not null check (cell_x between 0 and 1000000),
  explored_at timestamptz not null default now(),
  -- unique per player and cell; also the index for viewport range scans
  primary key (user_id, cell_y, cell_x)
);

-- per-player tracking state: last accepted fix (continuity across batches) and rate-limit window
create table public.exploration_state (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  last_lat     double precision,
  last_lng     double precision,
  last_at      timestamptz,
  window_start timestamptz not null default now(),
  window_cells integer not null default 0,
  updated_at   timestamptz not null default now()
);

alter table public.explored_cells enable row level security;
alter table public.exploration_state enable row level security;
revoke all on public.explored_cells, public.exploration_state from anon, authenticated;
-- players read only their own cells; all writes go through record_exploration()
grant select on public.explored_cells to authenticated;
create policy explored_cells_read_own on public.explored_cells for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- record a batch of GPS fixes
-- ---------------------------------------------------------------------------
-- p_points: [{lat, lng, accuracy (m), t (ms since epoch)}] in chronological order, ≤ 300.
-- Rules (mirrored loosely by the client filter, but enforced here):
--   accuracy ≤ 35 m; inside the game area; t ≤ now() + 30 s, ≥ now() − 30 min and after the last
--   accepted fix (claimed walking time can never exceed real elapsed time);
--   speed > 7 m/s within 2 min of the previous fix → outlier, skipped;
--   gap > 30 s → new segment (nothing revealed across the gap); a single fix reveals nothing;
--   otherwise the segment is sampled every 5 m and the sampled cells are revealed;
--   at most 1500 new cells per player per 10 minutes.
-- Returns {accepted, rejected: {reason: count}, newCells: [[y, x]], totalCells}.
create or replace function public.record_exploration(p_points jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_lat_step constant double precision := 0.0002;
  c_lng_step constant double precision := 0.00036;
  c_max_accuracy constant double precision := 35;
  c_max_speed constant double precision := 7;      -- m/s: brisk run / slow bike
  c_gap_s constant double precision := 30;
  c_outlier_window_s constant double precision := 120;
  c_sample_m constant double precision := 5;
  c_window_cap constant integer := 1500;
  v_uid uuid := auth.uid();
  v_state public.exploration_state;
  v_p jsonb;
  v_lat double precision;
  v_lng double precision;
  v_acc double precision;
  v_t timestamptz;
  v_prev_lat double precision;
  v_prev_lng double precision;
  v_prev_t timestamptz;
  v_dt double precision;
  v_d double precision;
  v_n integer;
  v_cells jsonb := '[]'::jsonb;
  v_rejected jsonb := '{}'::jsonb;
  v_reason text;
  v_accepted integer := 0;
  v_new jsonb;
  v_new_count integer;
  v_total integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_points) is distinct from 'array' or jsonb_array_length(p_points) > 300 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  insert into public.exploration_state (user_id) values (v_uid) on conflict (user_id) do nothing;
  select * into v_state from public.exploration_state where user_id = v_uid for update;
  v_prev_lat := v_state.last_lat;
  v_prev_lng := v_state.last_lng;
  v_prev_t := v_state.last_at;

  for v_p in select value from jsonb_array_elements(p_points) loop
    v_reason := null;
    begin
      v_lat := (v_p ->> 'lat')::double precision;
      v_lng := (v_p ->> 'lng')::double precision;
      v_acc := (v_p ->> 'accuracy')::double precision;
      v_t := to_timestamp((v_p ->> 't')::double precision / 1000);
    exception when others then
      v_reason := 'invalid';
    end;
    if v_reason is null and (v_lat is null or v_lng is null or v_acc is null or v_t is null
        or v_lat <> v_lat or v_lng <> v_lng or v_acc < 0) then  -- x <> x catches NaN
      v_reason := 'invalid';
    end if;
    -- game area: Moscow incl. New Moscow
    if v_reason is null and (v_lat not between 55.1 and 56.2 or v_lng not between 36.8 and 38.4) then
      v_reason := 'outside_area';
    end if;
    if v_reason is null and v_acc > c_max_accuracy then
      v_reason := 'inaccurate';
    end if;
    if v_reason is null and (v_t > now() + interval '30 seconds' or v_t < now() - interval '30 minutes') then
      v_reason := 'bad_time';
    end if;
    if v_reason is null and v_prev_t is not null and v_t <= v_prev_t then
      v_reason := 'out_of_order';
    end if;

    if v_reason is null and v_prev_t is not null then
      v_dt := extract(epoch from (v_t - v_prev_t));
      v_d := extensions.st_distance(
        extensions.st_setsrid(extensions.st_makepoint(v_prev_lng, v_prev_lat), 4326)::extensions.geography,
        extensions.st_setsrid(extensions.st_makepoint(v_lng, v_lat), 4326)::extensions.geography);
      if v_dt <= c_outlier_window_s and v_d / v_dt > c_max_speed then
        v_reason := 'too_fast';
      elsif v_dt <= c_gap_s and v_d > 0 then
        -- reveal the segment: samples every 5 m, both ends included
        v_n := greatest(1, ceil(v_d / c_sample_m)::integer);
        select v_cells || coalesce(jsonb_agg(distinct jsonb_build_array(
                 floor((v_prev_lat + (v_lat - v_prev_lat) * i / v_n + 90) / c_lat_step)::integer,
                 floor((v_prev_lng + (v_lng - v_prev_lng) * i / v_n + 180) / c_lng_step)::integer)), '[]'::jsonb)
          into v_cells
          from generate_series(0, v_n) as i;
      end if;
      -- gap > 30 s or no movement: the fix only becomes the new anchor
    end if;

    if v_reason is null then
      v_accepted := v_accepted + 1;
      v_prev_lat := v_lat;
      v_prev_lng := v_lng;
      v_prev_t := v_t;
    else
      v_rejected := jsonb_set(v_rejected, array[v_reason], to_jsonb(coalesce((v_rejected ->> v_reason)::integer, 0) + 1));
    end if;
  end loop;

  -- rate limit window
  if v_state.window_start < now() - interval '10 minutes' then
    v_state.window_start := now();
    v_state.window_cells := 0;
  end if;

  with candidates as (
    select distinct (c ->> 0)::integer as y, (c ->> 1)::integer as x
    from jsonb_array_elements(v_cells) as c
    limit greatest(c_window_cap - v_state.window_cells, 0)
  ), inserted as (
    insert into public.explored_cells (user_id, cell_y, cell_x)
    select v_uid, y, x from candidates
    on conflict do nothing
    returning cell_y, cell_x
  )
  select coalesce(jsonb_agg(jsonb_build_array(cell_y, cell_x)), '[]'::jsonb), count(*)::integer
    into v_new, v_new_count
    from inserted;

  update public.exploration_state set
    last_lat = v_prev_lat,
    last_lng = v_prev_lng,
    last_at = v_prev_t,
    window_start = v_state.window_start,
    window_cells = v_state.window_cells + v_new_count,
    updated_at = now()
  where user_id = v_uid;

  select count(*)::integer into v_total from public.explored_cells where user_id = v_uid;
  return jsonb_build_object('accepted', v_accepted, 'rejected', v_rejected, 'newCells', v_new, 'totalCells', v_total);
end;
$$;

-- ---------------------------------------------------------------------------
-- the caller's explored cells in a viewport
-- ---------------------------------------------------------------------------
create or replace function public.explored_cells_in_bbox(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision,
  p_limit integer default 20000
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 20000), 1), 20000);
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_min_lng is null or p_min_lat is null or p_max_lng is null or p_max_lat is null
     or p_min_lng >= p_max_lng or p_min_lat >= p_max_lat
     or p_min_lng < -180 or p_max_lng > 180 or p_min_lat < -90 or p_max_lat > 90 then
    raise exception 'invalid_bbox' using errcode = '22023';
  end if;
  if (p_max_lng - p_min_lng) > 0.2 or (p_max_lat - p_min_lat) > 0.2 then
    raise exception 'bbox_too_large' using errcode = '22023';
  end if;

  with hits as (
    select cell_y, cell_x from public.explored_cells
    where user_id = v_uid
      and cell_y between floor((p_min_lat + 90) / 0.0002)::integer and floor((p_max_lat + 90) / 0.0002)::integer
      and cell_x between floor((p_min_lng + 180) / 0.00036)::integer and floor((p_max_lng + 180) / 0.00036)::integer
    order by cell_y, cell_x
    limit v_limit + 1
  )
  select jsonb_build_object(
    'truncated', count(*) > v_limit,
    'cells', coalesce(jsonb_agg(jsonb_build_array(cell_y, cell_x)) filter (where rn <= v_limit), '[]'::jsonb),
    'totalCells', (select count(*) from public.explored_cells where user_id = v_uid)
  ) into v_result
  from (select h.*, row_number() over (order by cell_y, cell_x) as rn from hits h) n;
  return v_result;
end;
$$;

revoke execute on function public.record_exploration(jsonb) from public, anon, authenticated;
revoke execute on function public.explored_cells_in_bbox(double precision, double precision, double precision, double precision, integer) from public, anon, authenticated;
grant execute on function public.record_exploration(jsonb) to authenticated;
grant execute on function public.explored_cells_in_bbox(double precision, double precision, double precision, double precision, integer) to authenticated;
