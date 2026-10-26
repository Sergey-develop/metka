-- «Коллекции по стилям» and «Редкость артефактов» on the tasks page (mockup задания.png, 2026-10-24).
--
--   * A style collection is a set of imported OSM buildings recognised by their tags:
--       constructivism — building:architecture = constructivism
--       stalinist      — building:architecture = stalinist_neoclassicism (the tag does not single out the
--                        seven skyscrapers, so the collection is «Сталинский ампир»)
--       water_tower    — man_made = water_tower or building = water_tower
--     Parks from the mockup are not imported (the import takes buildings and organisations only).
--   * «Collected» = the player explored a cell within ±2 cells (~22 m) of the building's point —
--     the same rule as visited streets (player_stats). Totals cover everything imported.
--   * Rarity: game buildings found by the player out of the active catalog, per rarity.

create index if not exists osm_buildings_architecture_idx on public.osm_buildings ((tags ->> 'building:architecture'))
  where tags ? 'building:architecture';
create index if not exists osm_buildings_water_tower_idx on public.osm_buildings (id)
  where tags ->> 'man_made' = 'water_tower' or tags ->> 'building' = 'water_tower';

create or replace function public.style_collections()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_near constant integer := 2;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'collections', (
      with members as (
        select case
                 when b.tags ->> 'building:architecture' = 'constructivism' then 'constructivism'
                 when b.tags ->> 'building:architecture' = 'stalinist_neoclassicism' then 'stalinist'
                 else 'water_tower'
               end as collection,
               floor((extensions.st_y(b.centroid) + 90) / 0.0001)::integer as cy,
               floor((extensions.st_x(b.centroid) + 180) / 0.00018)::integer as cx
        from public.osm_buildings b
        where b.tags ->> 'building:architecture' in ('constructivism', 'stalinist_neoclassicism')
           or b.tags ->> 'man_made' = 'water_tower'
           or b.tags ->> 'building' = 'water_tower'
      ),
      walked as (
        select m.collection,
               exists (
                 select 1 from public.explored_cells c
                 where c.user_id = v_uid
                   and c.cell_y between m.cy - c_near and m.cy + c_near
                   and c.cell_x between m.cx - c_near and m.cx + c_near
               ) as seen
        from members m
      )
      select jsonb_agg(jsonb_build_object(
               'id', k.id,
               'collected', coalesce((select count(*) filter (where w.seen) from walked w where w.collection = k.id), 0),
               'total', coalesce((select count(*) from walked w where w.collection = k.id), 0)
             ) order by k.ord)
      from (values ('constructivism', 1), ('stalinist', 2), ('water_tower', 3)) as k (id, ord)
    ),
    'rarity', (
      select jsonb_agg(jsonb_build_object(
               'rarity', r.rarity,
               'found', (
                 select count(*) from public.player_buildings pb
                 join public.buildings b on b.id = pb.building_id and b.is_active
                 where pb.user_id = v_uid and b.rarity = r.rarity
               ),
               'total', (select count(*) from public.buildings b where b.is_active and b.rarity = r.rarity)
             ) order by r.ord)
      from (values ('rare', 1), ('epic', 2), ('legendary', 3)) as r (rarity, ord)
    )
  );
end;
$$;

revoke execute on function public.style_collections() from public, anon, authenticated;
grant execute on function public.style_collections() to authenticated;
