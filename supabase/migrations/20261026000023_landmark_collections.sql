-- «Коллекция и артефакты» (mockup «Коллекция и артефакты.jpg», 2026-10-26).
--
--   * A landmark collection is a curated list of places (skyscrapers, old trees, monuments, metro
--     halls) — not only buildings, so they are not in public.buildings / osm_buildings.
--   * The player marks a place with «Отметить» standing next to it: mark_landmark() takes the
--     current position and marks the nearest unmarked place of the collection within its radius
--     (+ up to 50 m of GPS error). Radii follow the size of the place: a monument 120 m, a park 1 km+.
--   * Coordinates are entrance / centre points taken by hand; places with a null location cannot be
--     marked yet (the point still needs checking on site).

create table public.landmark_collections (
  id    text primary key,
  title text not null,
  ord   integer not null
);

create table public.landmarks (
  id            text primary key,
  collection_id text not null references public.landmark_collections (id) on delete cascade,
  name          text not null,
  ord           integer not null,
  location      extensions.geography(Point, 4326),
  radius_m      real not null check (radius_m > 0)
);
create index landmarks_collection_idx on public.landmarks (collection_id, ord);

create table public.player_landmarks (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  landmark_id text not null references public.landmarks (id) on delete cascade,
  marked_at   timestamptz not null default now(),
  primary key (user_id, landmark_id)
);

-- read and written only through the functions below
alter table public.landmark_collections enable row level security;
alter table public.landmarks            enable row level security;
alter table public.player_landmarks     enable row level security;

insert into public.landmark_collections (id, title, ord) values
  ('skyscrapers', 'Сталинские высотки', 1),
  ('old_trees', 'Вековые деревья', 2),
  ('monuments', 'Самые необычные монументы', 3),
  ('metro', 'Секреты московского метро', 4);

insert into public.landmarks (id, collection_id, name, ord, location, radius_m)
select v.id, v.collection_id, v.name, v.ord,
       case when v.lat is null then null
            else extensions.st_setsrid(extensions.st_makepoint(v.lng, v.lat), 4326)::extensions.geography end,
       v.radius_m
from (values
  ('msu-main', 'skyscrapers', 'Главное здание МГУ', 1, 55.7033, 37.5302, 300),
  ('leningradskaya', 'skyscrapers', 'Гостиница «Ленинградская»', 2, 55.7746, 37.6487, 200),
  ('ukraina', 'skyscrapers', 'Гостиница «Украина»', 3, 55.7520, 37.5660, 250),
  ('kotelnicheskaya', 'skyscrapers', 'Высотка на Котельнической набережной', 4, 55.7472, 37.6430, 250),
  ('mid', 'skyscrapers', 'Министерство иностранных дел', 5, 55.7464, 37.5840, 200),
  ('kudrinskaya', 'skyscrapers', 'Высотка на Кудринской площади', 6, 55.7586, 37.5815, 200),
  ('red-gate', 'skyscrapers', 'Высотка у Красных ворот', 7, 55.7690, 37.6488, 200),

  ('kolomenskoye-oak', 'old_trees', 'Дуб в Коломенском', 1, 55.6672, 37.6705, 300),
  ('kuskovo-limes', 'old_trees', 'Старые липы в усадьбе Кусково', 2, 55.7352, 37.8088, 400),
  -- which reserve's «Царь-дуб» the mockup means is not settled yet
  ('tsar-oak', 'old_trees', 'Царь-дуб в музее-заповеднике', 3, null, null, 300),
  ('vorobyovy-oaks', 'old_trees', 'Дубовая роща на Воробьёвых горах', 4, 55.7095, 37.5490, 600),
  ('botanical-garden', 'old_trees', 'Главный ботанический сад', 5, 55.8420, 37.5990, 1200),
  ('sokolniki', 'old_trees', 'Парк Сокольники', 6, 55.7955, 37.6780, 1200),
  ('serebryany-bor', 'old_trees', 'Серебряный бор', 7, 55.7790, 37.4250, 1500),

  ('space-conquerors', 'monuments', 'Монумент «Покорителям космоса»', 1, 55.8227, 37.6397, 150),
  ('sherlock', 'monuments', 'Памятник Шерлоку Холмсу и доктору Ватсону', 2, 55.7488, 37.5826, 120),
  ('mayakovsky', 'monuments', 'Памятник Маяковскому', 3, 55.7698, 37.5958, 120),
  ('laika', 'monuments', 'Памятник собаке-космонавту Лайке', 4, 55.7915, 37.5635, 150),
  ('mumu', 'monuments', 'Памятник Муму', 5, 55.7387, 37.5953, 120),
  -- the point is not settled yet
  ('munchausen', 'monuments', 'Памятник барону Мюнхгаузену', 6, null, null, 120),

  ('revolution-square', 'metro', 'Скульптура на «Площади Революции»', 1, 55.7567, 37.6216, 200),
  ('mayakovskaya', 'metro', 'Мозаики «Маяковской»', 2, 55.7699, 37.5964, 200),
  ('novoslobodskaya', 'metro', 'Витражи «Новослободской»', 3, 55.7796, 37.6013, 200),
  ('kievskaya', 'metro', 'Панно «Киевской»', 4, 55.7435, 37.5653, 200),
  ('aviamotornaya', 'metro', 'Колонны «Авиамоторной»', 5, 55.7518, 37.7166, 200)
) as v (id, collection_id, name, ord, lat, lng, radius_m);

create or replace function public.landmark_collections()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id,
             'title', c.title,
             'items', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'id', l.id,
                        'name', l.name,
                        'marked', exists (
                          select 1 from public.player_landmarks pl where pl.user_id = v_uid and pl.landmark_id = l.id
                        )
                      ) order by l.ord), '[]'::jsonb)
               from public.landmarks l
               where l.collection_id = c.id
             )
           ) order by c.ord)
    from public.landmark_collections c
  ), '[]'::jsonb);
end;
$$;

-- {marked: {id, name} | null, nearest: {name, distance_m} | null} — nearest is the closest unmarked
-- place of the collection when nothing was in reach (null when all are marked or have no point)
create or replace function public.mark_landmark(p_collection text, p_lat double precision, p_lng double precision, p_accuracy_m real)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_point extensions.geography;
  v_slack real;
  v_id text;
  v_name text;
  v_distance real;
  v_in_reach boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_accuracy_m is null or p_accuracy_m <= 0 or p_accuracy_m = 'NaN'::real then
    raise exception 'invalid_location' using errcode = '22023';
  end if;
  if not exists (select 1 from public.landmark_collections c where c.id = p_collection) then
    raise exception 'collection_not_found' using errcode = '22023';
  end if;

  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
  v_slack := least(p_accuracy_m, 50);

  select l.id, l.name, extensions.st_distance(l.location, v_point)::real,
         extensions.st_dwithin(l.location, v_point, l.radius_m + v_slack)
    into v_id, v_name, v_distance, v_in_reach
  from public.landmarks l
  where l.collection_id = p_collection
    and l.location is not null
    and not exists (select 1 from public.player_landmarks pl where pl.user_id = v_uid and pl.landmark_id = l.id)
  order by extensions.st_distance(l.location, v_point) - l.radius_m
  limit 1;

  if v_id is null then
    return jsonb_build_object('marked', null, 'nearest', null);
  end if;
  if not v_in_reach then
    return jsonb_build_object('marked', null, 'nearest', jsonb_build_object('name', v_name, 'distance_m', round(v_distance)));
  end if;

  insert into public.player_landmarks (user_id, landmark_id) values (v_uid, v_id) on conflict do nothing;
  return jsonb_build_object('marked', jsonb_build_object('id', v_id, 'name', v_name), 'nearest', null);
end;
$$;

revoke execute on function public.landmark_collections() from public, anon, authenticated;
grant execute on function public.landmark_collections() to authenticated;
revoke execute on function public.mark_landmark(text, double precision, double precision, real) from public, anon, authenticated;
grant execute on function public.mark_landmark(text, double precision, double precision, real) to authenticated;
