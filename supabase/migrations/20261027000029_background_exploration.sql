-- Exploration in the background (native app, phone in a pocket, 2026-10-27): the phone may hold back the
-- app's uploads for a long time (iOS/Android throttle a backgrounded web view), so a walk can reach the
-- server hours later. record_exploration accepted points only up to 30 minutes old ('bad_time'); now up
-- to 6 hours. The 10-minute cap of 2000 cells now counts walk time (the newest accepted point) instead of
-- upload time, so a long walk uploaded in one go keeps its tail. Everything else is the body of migration
-- 022 unchanged: speed, accuracy, order and game area still apply.

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
  c_half_width_m constant double precision := 18;
  c_window_cap constant integer := 2000;
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
    -- game areas: Moscow incl. New Moscow, Zavidovo (in_game_area)
    if v_reason is null and not public.in_game_area(v_lat, v_lng) then
      v_reason := 'outside_area';
    end if;
    if v_reason is null and v_acc > c_max_accuracy then
      v_reason := 'inaccurate';
    end if;
    if v_reason is null and (v_t > now() + interval '30 seconds' or v_t < now() - interval '6 hours') then
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

  -- rate limit window, in walk time (the newest accepted point), not upload time: a walk sent hours
  -- later in one go is capped per 10 minutes of walking, so its tail is not cut off
  if v_prev_t is not null and (v_state.window_start is null or v_state.window_start < v_prev_t - interval '10 minutes') then
    v_state.window_start := v_prev_t;
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

revoke execute on function public.record_exploration(jsonb) from public, anon, authenticated;
grant execute on function public.record_exploration(jsonb) to authenticated;
