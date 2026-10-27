-- Zavidovo: places, quest routes and artifacts (content plan «Что интересного есть в Завидово», 2026-10-27).
--
--   * area_places — the base of places of a game area (bay, «Ямской лес», the village of Zavidovo, resort
--     extras). Points come from OpenStreetMap (2026-10-27); needs_check = the point is approximate (no own
--     OSM object, or the resort's name does not match OSM) and must be checked on site. A null location
--     cannot be visited yet.
--   * quest_routes / route_steps — a route is a quest of ordered steps. A step is done once:
--       checkin  — the player stands at the step's place (radius + up to 50 m of GPS error);
--       photo    — the same check; the photo itself stays on the device (nothing proves what is on it);
--       question — a choice; `correct` null means every answer counts (an opinion), otherwise only the
--                  right one; with a place the player must also be there.
--     Steps can be done in any order (a closed museum must not block the route); the app suggests the
--     order. When the last step is done the route's final reward is granted in the same call.
--   * artifacts — earned by steps, route finals and two rules: «След исследователя» (steps at three
--     different places) and «Карта первооткрывателя» (the first completed route).
--   * XP/coins go through reward_ledger (one row per step / route) like scans and quests.
--   * The Zavidovo game area now includes the old village (lat 56.52+): in_game_area and area_progress.

create or replace function public.in_game_area(p_lat double precision, p_lng double precision)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_lat between 55.1 and 56.2 and p_lng between 36.8 and 38.4)
      or (p_lat between 56.52 and 56.62 and p_lng between 36.48 and 36.58)
$$;

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
             when 'zavidovo' then extensions.st_makeenvelope(36.48, 56.52, 36.58, 56.62, 4326)
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

alter table public.reward_ledger drop constraint if exists reward_ledger_source_type_check;
alter table public.reward_ledger add constraint reward_ledger_source_type_check
  check (source_type in ('building_discovery', 'quest', 'route_step', 'route'));

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------
create table public.area_places (
  id          text primary key check (id ~ '^[a-z0-9-]{2,64}$'),
  area        text not null check (area in ('moscow', 'zavidovo')),
  zone        text not null check (zone in ('bay', 'forest', 'village', 'resort')),
  category    text not null check (char_length(category) between 2 and 40),
  name        text not null check (char_length(name) between 2 and 120),
  description text not null,
  idea        text,
  address     text,
  location    extensions.geography(Point, 4326),
  radius_m    real not null check (radius_m between 20 and 2000),
  is_partner  boolean not null default false,
  needs_check boolean not null default false,
  ord         integer not null
);

create table public.artifact_collections (
  id    text primary key,
  area  text not null,
  title text not null,
  ord   integer not null
);

create table public.artifacts (
  id            text primary key check (id ~ '^[a-z0-9-]{2,64}$'),
  collection_id text not null references public.artifact_collections (id) on delete cascade,
  title         text not null,
  how           text not null,
  ord           integer not null
);

create table public.quest_routes (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9-]{2,64}$'),
  area         text not null,
  title        text not null,
  quest_title  text not null,
  description  text not null,
  duration     text not null,
  audience     text not null,
  categories   text[] not null default '{}',
  note         text,
  final_title  text not null,
  final_text   text not null,
  reward_xp    integer not null check (reward_xp between 0 and 10000),
  reward_coins integer not null check (reward_coins between 0 and 10000),
  artifact_id  text references public.artifacts (id) on delete set null,
  ord          integer not null,
  is_active    boolean not null default true
);

create table public.route_steps (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,64}$'),
  route_id    uuid not null references public.quest_routes (id) on delete cascade,
  ord         integer not null,
  title       text not null,
  task        text not null,
  kind        text not null check (kind in ('checkin', 'photo', 'question')),
  place_id    text references public.area_places (id) on delete restrict,
  question    text,
  options     jsonb,
  correct     integer,
  safety      text,
  reward_xp   integer not null check (reward_xp between 0 and 10000),
  artifact_id text references public.artifacts (id) on delete set null,
  unique (route_id, ord),
  check ((kind = 'question') = (options is not null and question is not null)),
  check (options is null or (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6)),
  check (correct is null or (options is not null and correct between 0 and jsonb_array_length(options) - 1)),
  check (kind = 'question' or place_id is not null)
);
create index route_steps_route_idx on public.route_steps (route_id, ord);

create table public.player_route_steps (
  user_id uuid not null references public.profiles (id) on delete cascade,
  step_id uuid not null references public.route_steps (id) on delete cascade,
  answer  integer,
  done_at timestamptz not null default now(),
  primary key (user_id, step_id)
);

create table public.player_routes (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  route_id     uuid not null references public.quest_routes (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, route_id)
);

create table public.player_artifacts (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  artifact_id text not null references public.artifacts (id) on delete cascade,
  earned_at   timestamptz not null default now(),
  primary key (user_id, artifact_id)
);

-- read and written only through the functions below
alter table public.area_places          enable row level security;
alter table public.artifact_collections enable row level security;
alter table public.artifacts            enable row level security;
alter table public.quest_routes         enable row level security;
alter table public.route_steps          enable row level security;
alter table public.player_route_steps   enable row level security;
alter table public.player_routes        enable row level security;
alter table public.player_artifacts     enable row level security;
revoke all on public.area_places, public.artifact_collections, public.artifacts, public.quest_routes,
  public.route_steps, public.player_route_steps, public.player_routes, public.player_artifacts
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- content: places (OSM points of 2026-10-27; needs_check = verify on site)
-- ---------------------------------------------------------------------------
insert into public.area_places (id, area, zone, category, name, description, idea, address, location, radius_m, is_partner, needs_check, ord)
select v.id, 'zavidovo', v.zone, v.category, v.name, v.description, v.idea, v.address,
       case when v.lat is null then null
            else extensions.st_setsrid(extensions.st_makepoint(v.lng, v.lat), 4326)::extensions.geography end,
       v.radius_m, v.is_partner, v.needs_check, v.ord
from (values
  -- А. Набережная и бухта
  ('zav-bay', 'bay', 'Природа / вода', 'Главная бухта',
   'Сердце курорта: бухта на Шошинском плёсе с причалами и арт-объектом «Я ♥ Завидово».',
   'Чек-ин, фото, открытие локации', null::text, 56.59365, 36.51869, 150::real, false, false, 1),
  ('zav-embankment', 'bay', 'Прогулки', 'Набережная и променад',
   'Прогулочная дорожка вдоль воды от бухты к пляжу.',
   'Прогулочный челлендж, фото', null, 56.59520, 36.51720, 150, false, true, 2),
  ('zav-bridge', 'bay', 'Панорама / фото', 'Пешеходный мост',
   'Деревянный мостик над протокой у пляжа — вид на воду с двух сторон.',
   'Найти лучший ракурс', null, 56.59821, 36.51882, 60, false, true, 3),
  ('zav-beach', 'bay', 'Отдых / спорт', 'Пляжная зона',
   'Песчаный пляж курорта у пешеходного променада.',
   'Чек-ин, задание на наблюдательность', null, 56.59664, 36.51529, 120, false, false, 4),
  ('zav-yacht-club', 'bay', 'Вода / спорт', 'Яхт-клуб в главной бухте',
   'Причалы яхт-клуба Завидово: парусные и моторные яхты.',
   'Найти яхту определённого типа', null, 56.59265, 36.52048, 150, false, false, 5),
  ('zav-meridian', 'bay', 'Вода / инфраструктура', 'Яхт-клуб «Меридиан»',
   'Яхт-клуб курорта. Точка на карте пока не уточнена.',
   'Найти точку, изучить историю места', null, null, null, 150, false, true, 6),
  ('zav-river-port', 'bay', 'Транспорт / вода', 'Речной порт',
   'Место отправления речного трамвайчика (по OSM — строящийся речной вокзал).',
   'Найти место отправления, открыть точку', null, 56.60509, 36.52430, 120, false, true, 7),
  ('zav-aqua-spa', 'bay', 'Отдых', '«Завидово АКВА & СПА»',
   'Спа-комплекс курорта с банными домами у воды.',
   'Точка интереса, поиск места на карте', null, 56.60040, 36.51365, 120, false, true, 8),
  ('zav-tsarevna', 'bay', 'Еда / партнёр', 'Ресторан «Царевна»',
   'Ресторан русской кухни на берегу, рядом со спа-комплексом.',
   'Финиш прогулки, потенциальный оффер', null, 56.60028, 36.51376, 60, true, false, 9),
  ('zav-krym', 'bay', 'Еда / партнёр', 'Ресторан «Крым»',
   'Ресторан курорта на Архангельской улице.',
   'Финиш маршрута или задание заведения', null, 56.57517, 36.54002, 60, true, false, 10),
  -- Б. «Ямской лес»
  ('zav-yamskoy-les', 'forest', 'Эко', 'Природный парк «Ямской лес»',
   'Около 8 км экотроп с покрытием из щепы и асфальтовые дорожки для прогулок, велосипедов и роликов.',
   'Открыть природную территорию', null, 56.59711, 36.54742, 700, false, false, 11),
  ('zav-forest-entrance', 'forest', 'Эко', 'Вход в лес',
   'Информационный стенд у начала лесных дорожек.',
   'Начало лесного маршрута', null, 56.58872, 36.55037, 80, false, true, 12),
  ('zav-ant-trail', 'forest', 'Эко / приключение', '«Муравьиная тропа»',
   'Тематическая тропа курорта. Наблюдай с дорожки, муравейники не трогать.',
   'Пройти маршрут и выполнить задания', null, 56.59868, 36.52875, 150, false, true, 13),
  ('zav-eco-trail', 'forest', 'Эко', 'Лесная экотропа',
   'Деревянный настил через лес и заболоченные места.',
   'Пройти заданный участок', null, 56.60157, 36.54499, 150, false, true, 14),
  ('zav-sloboda-lake', 'forest', 'Природа', 'Озеро у «Ямской слободы»',
   'Пруд рядом с посёлком «Ямская слобода».',
   'Найти точку и сделать фото', null, 56.59488, 36.53551, 150, false, true, 15),
  ('zav-sloboda', 'forest', 'Архитектура / отдых', '«Ямская слобода»',
   'Посёлок курорта в стиле старой ямской слободы.',
   'Найти объект, изучить карточку', null, 56.58800, 36.53734, 250, false, true, 16),
  ('zav-bike-paths', 'forest', 'Спорт', 'Велосипедные дорожки',
   'Асфальтовые дорожки через «Ямской лес» для велосипедов, роликов и прогулок.',
   'Пройти или проехать маршрут', null, 56.59441, 36.54330, 200, false, false, 17),
  ('zav-tea-house', 'forest', 'Еда / партнёр', '«Чайный домик»',
   'Кафе у прудов на краю леса.',
   'Финиш лесной прогулки', null, 56.58975, 36.56109, 60, true, false, 18),
  -- В. Историческое село Завидово
  ('zav-temple-complex', 'village', 'История / архитектура', 'Храмовый комплекс Завидово',
   'Успенская и Троицкая церкви, колокольня и музеи об истории села, народных промыслах и Государевой дороге.',
   'Открыть исторический кластер', 'село Завидово, ул. Речная, 22', 56.52978, 36.53033, 120, false, false, 19),
  ('zav-uspenskaya', 'village', 'Архитектура', 'Церковь Успения Пресвятой Богородицы',
   'Главный храм комплекса.',
   'Найти храм и узнать год', 'село Завидово, ул. Речная, 22', 56.52964, 36.53138, 50, false, false, 20),
  ('zav-troitskaya', 'village', 'Архитектура', 'Церковь Святой Троицы',
   'Второй храм комплекса.',
   'Найти второй храм комплекса', 'село Завидово, ул. Речная, 22', 56.52989, 36.53091, 50, false, false, 21),
  ('zav-belltower', 'village', 'Архитектура', 'Пятиярусная колокольня',
   'Колокольня храмового комплекса.',
   'Найти объект, открыть карточку', 'село Завидово, ул. Речная, 22', 56.52978, 36.53033, 120, false, true, 22),
  ('zav-museum-road', 'village', 'Культура / история', 'Музей «Государева дорога»',
   'Экспозиция об историческом тракте между двумя столицами; среди экспонатов — макет Николаевской железной дороги.',
   'Ответить на вопрос об историческом тракте', 'село Завидово, ул. Речная, 22', 56.52997, 36.53030, 80, false, true, 23),
  ('zav-museum-history', 'village', 'Культура', 'Музей истории села и храмового комплекса',
   'История Завидово и храмового комплекса.',
   'Открыть историческую коллекцию', 'село Завидово, ул. Речная, 22', 56.52997, 36.53030, 80, false, false, 24),
  ('zav-museum-crafts', 'village', 'Культура / ремёсла', 'Музей народных промыслов России',
   'Предметы традиционных промыслов.',
   'Найти предмет традиционного промысла', 'село Завидово, ул. Речная, 22', 56.52978, 36.53033, 120, false, true, 25),
  ('zav-yamshchik-hut', 'village', 'История / быт', '«Ямщицкая изба»',
   'Быт ямщиков на старой дороге.',
   'Задание о жизни на старой дороге', 'село Завидово, ул. Речная, 22', 56.52978, 36.53033, 120, false, true, 26),
  -- Г. Дополнительные точки курорта
  ('zav-gorka', 'resort', 'Спорт / развлечения', 'Экстрим-парк «Горка Завидово»',
   'Склон и активности курорта (по OSM — строящийся горнолыжный склон).',
   'Точка интереса', null, 56.59466, 36.50187, 200, false, true, 27),
  ('zav-golf', 'resort', 'Спорт', 'Гольф-клуб Завидово PGA National',
   'Гольф-поле и школа гольфа.',
   'Точка интереса', null, 56.58272, 36.55488, 400, false, false, 28),
  ('zav-water-rental', 'resort', 'Спорт / вода', 'Водные активности и прокат',
   'Спортивный центр у воды (по OSM — «Акватория Лета»).',
   'Точка интереса', null, 56.59855, 36.51050, 120, false, true, 29),
  ('zav-tennis', 'resort', 'Спорт', 'Теннисный клуб',
   'Корты курорта. Точка на карте пока не уточнена.',
   'Точка интереса', null, null, null, 120, false, true, 30),
  ('zav-traktir', 'resort', 'Еда / партнёр', '«Трактиръ»',
   'Ресторан у кемпинга, рядом с «Ямским лесом».',
   'Финиш прогулки, потенциальный оффер', null, 56.59561, 36.53686, 60, true, false, 31)
) as v (id, zone, category, name, description, idea, address, lat, lng, radius_m, is_partner, needs_check, ord);

-- ---------------------------------------------------------------------------
-- content: artifacts
-- ---------------------------------------------------------------------------
insert into public.artifact_collections (id, area, title, ord) values
  ('zav-elements', 'zavidovo', 'Стихии Завидово', 1),
  ('zav-two-capitals', 'zavidovo', 'История двух столиц', 2),
  ('zav-postcards', 'zavidovo', 'Открытки Завидово', 3),
  ('zav-trophies', 'zavidovo', 'Трофеи маршрутов', 4);

insert into public.artifacts (id, collection_id, title, how, ord) values
  ('blue-wave', 'zav-elements', 'Синяя волна', 'Пройди маршрут «Поймай волну»', 1),
  ('forest-whisper', 'zav-elements', 'Лесной шёпот', 'Найди «великана» на «Муравьиной тропе»', 2),
  ('golden-horizon', 'zav-elements', 'Золотой горизонт', 'Сфотографируй горизонт с набережной', 3),
  ('explorer-trace', 'zav-elements', 'След исследователя', 'Выполни задания в трёх разных местах', 4),
  ('pioneer-map', 'zav-elements', 'Карта первооткрывателя', 'Заверши любой маршрут', 5),
  ('road-sign', 'zav-two-capitals', 'Путевой знак', 'Ответь на вопрос о музее «Государева дорога»', 1),
  ('bell-echo', 'zav-two-capitals', 'Звон прошлого', 'Найди пятиярусную колокольню', 2),
  ('master-trace', 'zav-two-capitals', 'След мастера', 'Найди в музее предмет из прошлого', 3),
  ('history-keeper', 'zav-two-capitals', 'Хранитель истории', 'Пройди маршрут «Государева дорога»', 4),
  ('reflection', 'zav-postcards', 'Отражение', 'Найди отражение в воде', 1),
  ('panorama', 'zav-postcards', 'Панорама', 'Сфотографируй вид с пешеходного моста', 2),
  ('quiet-shore', 'zav-postcards', 'Тихий берег', 'Дойди до яхт-клуба', 3),
  ('forest-shot', 'zav-postcards', 'Лесной кадр', 'Сфотографируй три оттенка леса', 4),
  ('first-discovery', 'zav-trophies', 'Первое открытие', 'Дойди до Главной бухты', 1),
  ('forest-voice', 'zav-trophies', 'Голос леса', 'Пройди маршрут «Лесная экспедиция»', 2);

-- ---------------------------------------------------------------------------
-- content: routes and steps
-- ---------------------------------------------------------------------------
insert into public.quest_routes (slug, area, title, quest_title, description, duration, audience, categories, note,
                                 final_title, final_text, reward_xp, reward_coins, artifact_id, ord) values
  ('zav-catch-wave', 'zavidovo', 'Завидово: поймай волну', 'Секреты большой воды',
   'Прогулка по набережной: бухта, мост, пляж и яхт-клуб. Открой точки у воды и собери открытки Завидово.',
   '30–45 мин', 'Для всех', array['Природа', 'Фото', 'Отдых'], null,
   'Исследователь большой воды', 'Все точки маршрута открыты.', 50, 100, 'blue-wave', 1),
  ('zav-forest', 'zavidovo', 'Завидово: лесная экспедиция', 'Следы лесного хранителя',
   'Экотропы «Ямского леса» и «Муравьиная тропа»: маленькие открытия на обычной прогулке.',
   '45–60 мин', 'Семьи, любители природы', array['Экология', 'Исследование', 'Прогулки'],
   'Остановки проверены по карте; доступность троп уточняйте на месте. Не сходите с разрешённых троп.',
   'Хранитель леса', 'Все задания в лесу выполнены.', 50, 100, 'forest-voice', 2),
  ('zav-tsar-road', 'zavidovo', 'Государева дорога', 'По следам старой дороги',
   'Исторический храмовый комплекс села Завидово: храмы, колокольня и музей о тракте между двумя столицами.',
   '45–90 мин', 'Взрослые, любители истории, семьи со старшими детьми', array['Культура', 'История', 'Архитектура'],
   'Село Завидово, ул. Речная, 22 — в 7 км от курорта. Учитывайте режим работы музеев; фото в музее — если разрешено.',
   'Хранитель истории', 'Старая дорога пройдена.', 50, 100, 'history-keeper', 3);

insert into public.route_steps (slug, route_id, ord, title, task, kind, place_id, question, options, correct, safety, reward_xp, artifact_id)
select v.slug, r.id, v.ord, v.title, v.task, v.kind, v.place_id, v.question, v.options::jsonb, v.correct, v.safety, v.reward_xp, v.artifact_id
from (values
  ('wave-1', 'zav-catch-wave', 1, 'Открой горизонт', 'Найди на карте Главную бухту и дойди до неё.',
   'checkin', 'zav-bay', null::text, null::text, null::integer, null::text, 30, 'first-discovery'),
  ('wave-2', 'zav-catch-wave', 2, 'Линия горизонта', 'Найди место на набережной, откуда хорошо видна вода, и сделай фото.',
   'photo', 'zav-embankment', null, null, null, null, 20, 'golden-horizon'),
  ('wave-3', 'zav-catch-wave', 3, 'Над водой', 'Дойди до пешеходного моста и сфотографируй воду с необычного ракурса.',
   'photo', 'zav-bridge', null, null, null, null, 30, 'panorama'),
  ('wave-4', 'zav-catch-wave', 4, 'Найди отражение', 'Найди у пляжа место, где в воде отражается небо, деревья или здания.',
   'question', 'zav-beach', 'Что отражается в воде?', '["Небо", "Деревья", "Здания", "Что-то другое"]', null, null, 20, 'reflection'),
  ('wave-5', 'zav-catch-wave', 5, 'Тихая гавань', 'Дойди до причалов яхт-клуба и посмотри на яхты.',
   'question', 'zav-yacht-club', 'Каких яхт у причала больше?', '["Парусных", "Моторных", "Поровну"]', null, null, 30, 'quiet-shore'),

  ('forest-1', 'zav-forest', 1, 'Вход в лес', 'Найди начало прогулочного маршрута — информационный стенд у лесных дорожек.',
   'checkin', 'zav-forest-entrance', null, null, null, null, 20, null),
  ('forest-2', 'zav-forest', 2, 'Найди великана', 'На «Муравьиной тропе» попробуй найти большой муравейник, если он виден с дорожки.',
   'checkin', 'zav-ant-trail', null, null, null,
   'Наблюдай с безопасного расстояния, не трогай муравейник и не сходи с тропы.', 30, 'forest-whisper'),
  ('forest-3', 'zav-forest', 3, 'Три оттенка осени', 'Найди в «Ямском лесу» три разных природных оттенка и сфотографируй их.',
   'photo', 'zav-yamskoy-les', null, null, null, null, 20, 'forest-shot'),
  ('forest-4', 'zav-forest', 4, 'Слушай лес', 'Остановись в безопасном месте и прислушайся к звукам вокруг.',
   'question', 'zav-yamskoy-les', 'Что ты услышал?', '["Птиц", "Ветер", "Шелест листьев", "Другой звук"]', null, null, 20, null),

  ('road-1', 'zav-tsar-road', 1, 'Найди старое Завидово', 'Доберись до храмового комплекса: село Завидово, улица Речная, 22.',
   'checkin', 'zav-temple-complex', null, null, null, null, 30, null),
  ('road-2', 'zav-tsar-road', 2, 'Первый храм', 'Найди на территории церковь Успения Пресвятой Богородицы.',
   'checkin', 'zav-uspenskaya', null, null, null, null, 20, null),
  ('road-3', 'zav-tsar-road', 3, 'Второй храм', 'Найди церковь Святой Троицы.',
   'checkin', 'zav-troitskaya', null, null, null, null, 20, null),
  ('road-4', 'zav-tsar-road', 4, 'Звон прошлого', 'Найди пятиярусную колокольню.',
   'checkin', 'zav-belltower', null, null, null, null, 20, 'bell-echo'),
  ('road-5', 'zav-tsar-road', 5, 'Дорога между столицами', 'Прочитай о музее «Государева дорога» и ответь на вопрос.',
   'question', null, 'Чему посвящена экспозиция музея?',
   '["Тракту, соединявшему две столицы", "Истории речного флота", "Царской охоте"]', 0, null, 30, 'road-sign'),
  ('road-6', 'zav-tsar-road', 6, 'Предмет из прошлого', 'Если музей открыт, найди предмет о старом транспорте, торговле, дороге или промысле и сфотографируй его (если это разрешено).',
   'photo', 'zav-museum-road', null, null, null, null, 30, 'master-trace')
) as v (slug, route_slug, ord, title, task, kind, place_id, question, options, correct, safety, reward_xp, artifact_id)
join public.quest_routes r on r.slug = v.route_slug;

-- ---------------------------------------------------------------------------
-- area_quests: everything the routes pages show
-- ---------------------------------------------------------------------------
create or replace function public._place_json(p public.area_places)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'zone', p.zone,
    'category', p.category,
    'name', p.name,
    'description', p.description,
    'idea', p.idea,
    'address', p.address,
    'lat', case when p.location is null then null else extensions.st_y(p.location::extensions.geometry) end,
    'lng', case when p.location is null then null else extensions.st_x(p.location::extensions.geometry) end,
    'radiusM', p.radius_m,
    'isPartner', p.is_partner,
    'needsCheck', p.needs_check
  );
$$;
revoke execute on function public._place_json(public.area_places) from public, anon, authenticated;

create or replace function public.area_quests(p_area text)
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
  return jsonb_build_object(
    'routes', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id,
               'slug', r.slug,
               'title', r.title,
               'questTitle', r.quest_title,
               'description', r.description,
               'duration', r.duration,
               'audience', r.audience,
               'categories', to_jsonb(r.categories),
               'note', r.note,
               'finalTitle', r.final_title,
               'finalText', r.final_text,
               'rewardXp', r.reward_xp,
               'rewardCoins', r.reward_coins,
               'artifact', (select jsonb_build_object('id', a.id, 'title', a.title) from public.artifacts a where a.id = r.artifact_id),
               'completedAt', (select pr.completed_at from public.player_routes pr where pr.user_id = v_uid and pr.route_id = r.id),
               'steps', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', s.id,
                          'slug', s.slug,
                          'ord', s.ord,
                          'title', s.title,
                          'task', s.task,
                          'kind', s.kind,
                          'question', s.question,
                          'options', s.options,
                          'safety', s.safety,
                          'rewardXp', s.reward_xp,
                          'artifact', (select jsonb_build_object('id', a.id, 'title', a.title) from public.artifacts a where a.id = s.artifact_id),
                          'place', (select public._place_json(p) from public.area_places p where p.id = s.place_id),
                          'doneAt', (select ps.done_at from public.player_route_steps ps where ps.user_id = v_uid and ps.step_id = s.id)
                        ) order by s.ord), '[]'::jsonb)
                 from public.route_steps s
                 where s.route_id = r.id
               )
             ) order by r.ord), '[]'::jsonb)
      from public.quest_routes r
      where r.area = p_area and r.is_active
    ),
    'places', (
      select coalesce(jsonb_agg(public._place_json(p) order by p.ord), '[]'::jsonb)
      from public.area_places p
      where p.area = p_area
    ),
    'collections', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', c.id,
               'title', c.title,
               'items', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', a.id,
                          'title', a.title,
                          'how', a.how,
                          'earnedAt', (select pa.earned_at from public.player_artifacts pa where pa.user_id = v_uid and pa.artifact_id = a.id)
                        ) order by a.ord), '[]'::jsonb)
                 from public.artifacts a
                 where a.collection_id = c.id
               )
             ) order by c.ord), '[]'::jsonb)
      from public.artifact_collections c
      where c.area = p_area
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_route_step: the only way to finish a step (and, with the last one, the route)
-- ---------------------------------------------------------------------------
-- returns {status: 'done' | 'already_done' | 'too_far' | 'wrong_answer', ...}; 'too_far' carries
-- distanceM and radiusM, 'done' the rewards, earned artifacts, routeCompleted and the new profile stats
create or replace function public.complete_route_step(
  p_step_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m real,
  p_answer integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_step public.route_steps%rowtype;
  v_route public.quest_routes%rowtype;
  v_place public.area_places%rowtype;
  v_point extensions.geography;
  v_distance real;
  v_xp integer;
  v_coins integer := 0;
  v_artifacts text[] := '{}';
  v_completed boolean := false;
  v_profile jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_step from public.route_steps where id = p_step_id;
  if not found then
    raise exception 'step_not_found' using errcode = 'P0001';
  end if;
  select * into v_route from public.quest_routes where id = v_step.route_id and is_active;
  if not found then
    raise exception 'step_not_found' using errcode = 'P0001';
  end if;

  -- one call at a time per player: the route completion and the «three places» rule count rows
  perform 1 from public.profiles where id = v_uid for update;

  if exists (select 1 from public.player_route_steps where user_id = v_uid and step_id = p_step_id) then
    return jsonb_build_object('status', 'already_done');
  end if;

  if v_step.kind = 'question' then
    if p_answer is null or p_answer < 0 or p_answer >= jsonb_array_length(v_step.options) then
      raise exception 'invalid_answer' using errcode = '22023';
    end if;
  end if;

  if v_step.place_id is not null then
    if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
       or p_accuracy_m is null or p_accuracy_m <= 0 or p_accuracy_m = 'NaN'::real then
      raise exception 'invalid_location' using errcode = '22023';
    end if;
    select * into v_place from public.area_places where id = v_step.place_id;
    if v_place.location is null then
      raise exception 'place_unavailable' using errcode = 'P0001';
    end if;
    v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
    v_distance := extensions.st_distance(v_place.location, v_point)::real;
    if v_distance > v_place.radius_m + least(p_accuracy_m, 50) then
      return jsonb_build_object('status', 'too_far', 'distanceM', round(v_distance), 'radiusM', v_place.radius_m);
    end if;
  end if;

  -- checked after the position: a wrong answer from afar would otherwise leak which option is right
  if v_step.kind = 'question' and v_step.correct is not null and p_answer <> v_step.correct then
    return jsonb_build_object('status', 'wrong_answer');
  end if;

  insert into public.player_route_steps (user_id, step_id, answer)
  values (v_uid, p_step_id, case when v_step.kind = 'question' then p_answer end);

  v_xp := v_step.reward_xp;
  insert into public.reward_ledger (user_id, source_type, source_id, xp, coins)
  values (v_uid, 'route_step', p_step_id, v_step.reward_xp, 0)
  on conflict (user_id, source_type, source_id) do nothing;
  if v_step.artifact_id is not null then
    v_artifacts := v_artifacts || v_step.artifact_id;
  end if;

  -- «След исследователя»: steps done at three different places (any route of the area)
  if (select count(distinct s.place_id)
        from public.player_route_steps ps
        join public.route_steps s on s.id = ps.step_id
        join public.quest_routes r on r.id = s.route_id
       where ps.user_id = v_uid and r.area = v_route.area and s.place_id is not null) >= 3
     and exists (select 1 from public.artifacts where id = 'explorer-trace') then
    v_artifacts := v_artifacts || 'explorer-trace'::text;
  end if;

  -- the last step finishes the route: its reward and artifact, and the first route gives the map
  if not exists (
    select 1 from public.route_steps s
    where s.route_id = v_route.id
      and not exists (select 1 from public.player_route_steps ps where ps.user_id = v_uid and ps.step_id = s.id)
  ) then
    insert into public.player_routes (user_id, route_id) values (v_uid, v_route.id) on conflict do nothing;
    v_completed := true;
    insert into public.reward_ledger (user_id, source_type, source_id, xp, coins)
    values (v_uid, 'route', v_route.id, v_route.reward_xp, v_route.reward_coins)
    on conflict (user_id, source_type, source_id) do nothing;
    v_xp := v_xp + v_route.reward_xp;
    v_coins := v_route.reward_coins;
    if v_route.artifact_id is not null then
      v_artifacts := v_artifacts || v_route.artifact_id;
    end if;
    if exists (select 1 from public.artifacts where id = 'pioneer-map') then
      v_artifacts := v_artifacts || 'pioneer-map'::text;
    end if;
  end if;

  -- only artifacts not earned before are reported
  with ins as (
    insert into public.player_artifacts (user_id, artifact_id)
    select v_uid, a from unnest(v_artifacts) as a
    on conflict do nothing
    returning artifact_id
  )
  select coalesce(array_agg(artifact_id), '{}') into v_artifacts from ins;

  update public.profiles
     set xp = xp + v_xp,
         coins = coins + v_coins,
         level = public.level_for_xp(xp + v_xp)
   where id = v_uid
  returning jsonb_build_object('level', level, 'xp', xp, 'coins', coins, 'buildingsDiscovered', buildings_discovered)
    into v_profile;

  return jsonb_build_object(
    'status', 'done',
    'reward', jsonb_build_object('xp', v_xp, 'coins', v_coins),
    'artifacts', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title) order by a.id), '[]'::jsonb)
      from public.artifacts a where a.id = any (v_artifacts)
    ),
    'routeCompleted', v_completed,
    'profile', v_profile
  );
end;
$$;

revoke execute on function public.area_quests(text) from public, anon, authenticated;
grant execute on function public.area_quests(text) to authenticated;
revoke execute on function public.complete_route_step(uuid, double precision, double precision, real, integer) from public, anon, authenticated;
grant execute on function public.complete_route_step(uuid, double precision, double precision, real, integer) to authenticated;
