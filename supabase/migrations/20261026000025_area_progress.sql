-- «Ты открыл X% …» on the profile names the game area the player is in (2026-10-26). Moscow is counted
-- from districts_overview(); outside Moscow there are no okrugs (migration 022), so area_progress()
-- counts the active game buildings inside the area's rectangle (the same rectangles as in_game_area())
-- and how many of them the player has discovered.

create or replace function public.area_progress(p_area text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_box extensions.geometry;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  v_box := case p_area
             when 'moscow' then extensions.st_makeenvelope(36.8, 55.1, 38.4, 56.2, 4326)
             when 'zavidovo' then extensions.st_makeenvelope(36.48, 56.57, 36.58, 56.62, 4326)
           end;
  if v_box is null then
    raise exception 'area_not_found' using errcode = '22023';
  end if;
  return (
    select jsonb_build_object(
             'total', count(*),
             'discovered', count(pb.building_id)
           )
    from public.buildings b
    left join public.player_buildings pb on pb.building_id = b.id and pb.user_id = v_uid
    where b.is_active
      and extensions.st_intersects(b.location::extensions.geometry, v_box)
  );
end;
$$;

revoke execute on function public.area_progress(text) from public, anon, authenticated;
grant execute on function public.area_progress(text) to authenticated;
