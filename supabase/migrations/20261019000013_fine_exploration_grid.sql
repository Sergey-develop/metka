-- Finer exploration grid and a corridor along the walked route (Fog of War, stage 2).
--
-- Grid: y = floor((lat + 90) / 0.0001), x = floor((lng + 180) / 0.00018)
--   ≈ 11.1 × 11.3 m in central Moscow (lat step 11.12 m everywhere; lng step 11.45 m at 55.1°N,
--   11.13 m at 56.2°N). Exactly half of the 0.0002 × 0.00036 grid of migration 008: the steps are
--   exact halves in binary floating point too (0.0002 = 2 × 0.0001, 0.00036 = 2 × 0.00018 as
--   doubles), so floor(v / step) of the new grid is always 2·old or 2·old + 1 — no point changes
--   its old cell, and the four new cells (2y..2y+1, 2x..2x+1) cover the old cell exactly, no gaps.
--
-- Corridor: a walked segment reveals every cell whose centre is within 8 m of it (≈16 m wide on
--   average; ~127–131 cells per km of walking across the game area). The actual width depends on
--   the direction of movement relative to the grid: about 10–22 m (≈90 cells/km when walking along
--   a row of cell centres, ≈180 cells/km along a row boundary). 8 m > the cell's half-diagonal
--   (7.88–7.99 m in the game area), so the cell under every point of the path is always revealed.
--   Previously the cells under 5 m samples were revealed: a 22–44 m strip with square edges.
--
-- Progress is preserved: every old cell becomes its four new cells with the same explored_at. The
-- old table is kept as explored_cells_v1 (no client access) for verification/rollback; drop it in a
-- later migration once the conversion is confirmed in production.
--
-- District threshold: 130 cells (≈1 km of streets with the new corridor; the old 50 coarse cells
-- were ≈0.92 km). An old 50-cell okrug becomes 200 new cells. Okrugs are assigned by cell centre, so
-- near an okrug border some of the four new cells may fall into the neighbour: check the dry run
-- (players_losing = 0) before applying. Players with 33–49 old cells in an okrug gain it (4 × 33 = 132).

-- ---------------------------------------------------------------------------
-- 0. guards: stop before changing anything if 013 is already applied or data cannot be converted
-- ---------------------------------------------------------------------------
-- Raising here aborts the whole migration (one transaction): nothing is renamed, created or copied.
do $$
begin
  if to_regclass('public.explored_cells_v1') is not null then
    raise exception 'migration 013 is already applied: public.explored_cells_v1 exists. Nothing was changed.'
      using errcode = 'P0001', hint = 'Run the read-only post-check (3_verify_readonly.sql) instead of re-applying.';
  end if;
  -- also after explored_cells_v1 has been dropped later: the current table is already on the new grid
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.explored_cells'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%1800000%'
  ) then
    raise exception 'migration 013 is already applied: public.explored_cells is on the fine grid. Nothing was changed.'
      using errcode = 'P0001', hint = 'Converting again would split every cell a second time.';
  end if;
  -- an old cell at exactly lat 90° (cell_y = 900000) has no place in the new grid (max 1800000);
  -- the server never accepted such fixes (game area: Moscow), so this only guards corrupt data
  if exists (select 1 from public.explored_cells where cell_y > 899999 or cell_x > 999999) then
    raise exception 'migration 013: explored_cells has cells outside the convertible range (cell_y > 899999 or cell_x > 999999). Nothing was changed.'
      using errcode = 'P0001', hint = 'Inspect them with the read-only pre-flight queries before applying.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. keep the old table as a backup
-- ---------------------------------------------------------------------------
alter table public.explored_cells rename to explored_cells_v1;
alter index public.explored_cells_pkey rename to explored_cells_v1_pkey;
drop policy explored_cells_read_own on public.explored_cells_v1;
revoke all on public.explored_cells_v1 from anon, authenticated;
comment on table public.explored_cells_v1 is
  'Exploration cells on the 0.0002 x 0.00036 grid (migration 008). Converted 1:4 into explored_cells by migration 013; kept for verification, no client access.';

-- ---------------------------------------------------------------------------
-- 2. new table (same shape, wider index ranges)
-- ---------------------------------------------------------------------------
-- index ranges of the new grid: y = 0 … 1800000 (lat −90 … 90), x = 0 … 1999999 (lng −180 … <180;
-- floor(360 / 0.00018) rounds to 1999999), so 2000000 is a safe upper bound for x
create table public.explored_cells (
  user_id     uuid not null references auth.users (id) on delete cascade,
  cell_y      integer not null check (cell_y between 0 and 1800000),
  cell_x      integer not null check (cell_x between 0 and 2000000),
  explored_at timestamptz not null default now(),
  -- unique per player and cell; also the index for viewport range scans
  primary key (user_id, cell_y, cell_x)
);

alter table public.explored_cells enable row level security;
revoke all on public.explored_cells from anon, authenticated;
-- players read only their own cells; all writes go through record_exploration()
grant select on public.explored_cells to authenticated;
create policy explored_cells_read_own on public.explored_cells for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. convert: each old cell → its four new cells, same explored_at
-- ---------------------------------------------------------------------------
insert into public.explored_cells (user_id, cell_y, cell_x, explored_at)
select c.user_id, c.cell_y * 2 + d.dy, c.cell_x * 2 + d.dx, c.explored_at
from public.explored_cells_v1 c
cross join (values (0, 0), (0, 1), (1, 0), (1, 1)) as d (dy, dx);

do $$
declare
  v_old bigint;
  v_new bigint;
begin
  select count(*) into v_old from public.explored_cells_v1;
  select count(*) into v_new from public.explored_cells;
  if v_new <> v_old * 4 then
    raise exception 'migration 013: converted % old cells into % new cells, expected %', v_old, v_new, v_old * 4;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. corridor cells of one segment
-- ---------------------------------------------------------------------------
-- Same maths as corridorCells() in src/services/exploration/grid.ts (local equirectangular
-- projection, 111 320 m per degree, cos(mean latitude) for longitude).
create or replace function public._corridor_cells(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision,
  p_half_width_m double precision default 8
)
returns table (cell_y integer, cell_x integer)
language sql
immutable
set search_path = ''
as $$
  with k as (
    select 111320.0::double precision as ky,
           111320.0 * cos(radians((p_lat1 + p_lat2) / 2)) as kx
  ), seg as (
    select k.kx, k.ky,
           (p_lng2 - p_lng1) * k.kx as ex,
           (p_lat2 - p_lat1) * k.ky as ey
    from k
  ), box as (
    select seg.*,
           floor((least(p_lat1, p_lat2) - p_half_width_m / seg.ky + 90) / 0.0001)::integer as y0,
           floor((greatest(p_lat1, p_lat2) + p_half_width_m / seg.ky + 90) / 0.0001)::integer as y1,
           floor((least(p_lng1, p_lng2) - p_half_width_m / seg.kx + 180) / 0.00018)::integer as x0,
           floor((greatest(p_lng1, p_lng2) + p_half_width_m / seg.kx + 180) / 0.00018)::integer as x1
    from seg
  ), cand as (
    select gy as y, gx as x, b.ex, b.ey,
           ((gx + 0.5) * 0.00018 - 180 - p_lng1) * b.kx as px,
           ((gy + 0.5) * 0.0001 - 90 - p_lat1) * b.ky as py
    from box b
    cross join generate_series(b.y0, b.y1) as gy
    cross join generate_series(b.x0, b.x1) as gx
  ), proj as (
    select y, x, px, py, ex, ey,
           case when ex * ex + ey * ey = 0 then 0
                else greatest(0, least(1, (px * ex + py * ey) / (ex * ex + ey * ey))) end as t
    from cand
  )
  select y, x from proj
  where sqrt((px - t * ex) ^ 2 + (py - t * ey) ^ 2) <= p_half_width_m
$$;

-- ---------------------------------------------------------------------------
-- 5. record a batch of GPS fixes (rules of migration 008; corridor instead of 5 m samples)
-- ---------------------------------------------------------------------------
-- p_points: [{lat, lng, accuracy (m), t (ms since epoch)}] in chronological order, ≤ 300.
--   accuracy ≤ 35 m; inside the game area; t ≤ now() + 30 s, ≥ now() − 30 min and after the last
--   accepted fix; speed > 7 m/s within 2 min of the previous fix → outlier, skipped;
--   gap > 30 s → new segment (nothing revealed across the gap); a single fix reveals nothing;
--   otherwise the 8 m corridor around the segment is revealed;
--   at most 1500 new cells per player per 10 minutes.
-- Returns {accepted, rejected: {reason: count}, newCells: [[y, x]], totalCells}.
create or replace function public.record_exploration(p_points jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_accuracy constant double precision := 35;
  c_max_speed constant double precision := 7;      -- m/s: brisk run / slow bike
  c_gap_s constant double precision := 30;
  c_outlier_window_s constant double precision := 120;
  c_half_width_m constant double precision := 8;
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
        select v_cells || coalesce(jsonb_agg(jsonb_build_array(c.cell_y, c.cell_x)), '[]'::jsonb)
          into v_cells
          from public._corridor_cells(v_prev_lat, v_prev_lng, v_lat, v_lng, c_half_width_m) c;
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
-- 6. the caller's explored cells in a viewport (new grid steps)
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
      and cell_y between floor((p_min_lat + 90) / 0.0001)::integer and floor((p_max_lat + 90) / 0.0001)::integer
      and cell_x between floor((p_min_lng + 180) / 0.00018)::integer and floor((p_max_lng + 180) / 0.00018)::integer
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

-- ---------------------------------------------------------------------------
-- 7. progress: new cell centres, district threshold 130 cells (≈1 km of streets)
-- ---------------------------------------------------------------------------
create or replace function public.player_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_district_min_cells constant integer := 130;
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
             (c.cell_x + 0.5) * 0.00018 - 180, (c.cell_y + 0.5) * 0.0001 - 90), 4326)::extensions.geography)
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

revoke execute on function public._corridor_cells(double precision, double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.record_exploration(jsonb) from public, anon, authenticated;
revoke execute on function public.explored_cells_in_bbox(double precision, double precision, double precision, double precision, integer) from public, anon, authenticated;
revoke execute on function public.player_progress() from public, anon, authenticated;
grant execute on function public.record_exploration(jsonb) to authenticated;
grant execute on function public.explored_cells_in_bbox(double precision, double precision, double precision, double precision, integer) to authenticated;
grant execute on function public.player_progress() to authenticated;
