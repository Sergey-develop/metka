-- Zavidovo core zone (owner's outline on the map, 2026-10-27): everything of the resort inside it, nothing
-- outside.
--
--   * area_zones — the outline as a polygon. It was drawn by hand on a Yandex screenshot, turned into
--     coordinates by fitting four known points (residual ≤ 33 m) and grown by 100 m, so places on the shore
--     line (Акватория лета, the bath houses) stay inside.
--   * area_places get chip categories (`tags`, the map's Спорт / Культура / С детьми / Бесплатно / Еда /
--     Отдых), opening hours, phone, website and is_active. New places: OSM objects inside the zone
--     (hotels, banya, camping, sports grounds, memorial, …) and six places from the owner's Yandex
--     screenshot that OSM does not have (needs_check: the point is ±30 m).
--   * Outside the zone: places are deactivated, the «Государева дорога» route (the old village is 7 km
--     away) and the artifacts only it gave are hidden. Nothing is deleted — `is_active` brings it back.
--     «Лесная экспедиция» moves onto the «Муравьиная тропа» loop and the pond by «Ямская», inside the zone.
--   * publish_osm_buildings_in_zone(): every imported OSM outline inside the zone becomes a published game
--     building (outhouses skipped, as in migration 022); bulk-published Zavidovo buildings outside it are
--     hidden. Run once at the end of this migration; again after a new OSM import (service role).

create table public.area_zones (
  id       text primary key check (id ~ '^[a-z0-9-]{2,64}$'),
  area     text not null,
  title    text not null,
  boundary extensions.geography(Polygon, 4326) not null
);
alter table public.area_zones enable row level security;
revoke all on public.area_zones from anon, authenticated;

insert into public.area_zones (id, area, title, boundary) values (
  'zavidovo-core', 'zavidovo', 'Курорт Завидово',
  extensions.st_geogfromtext('SRID=4326;POLYGON((
    36.510259 56.601626, 36.518658 56.601814, 36.522506 56.603291, 36.527447 56.603009,
    36.52871 56.601443, 36.530358 56.601531, 36.533674 56.601991, 36.537843 56.601596,
    36.539813 56.599767, 36.541364 56.597569, 36.54298 56.595277, 36.542922 56.592433, 36.54177 56.59062,
    36.535782 56.59095, 36.530302 56.591539, 36.527598 56.59155, 36.525354 56.590635,
    36.522654 56.589021, 36.518523 56.586426, 36.516725 56.587448, 36.513962 56.588196,
    36.513664 56.591642, 36.513873 56.594696, 36.512123 56.596581, 36.510415 56.598166,
    36.510259 56.601626))')
);

-- ---------------------------------------------------------------------------
-- places: categories, contacts, active flag
-- ---------------------------------------------------------------------------
alter table public.area_places
  add column tags          text[] not null default '{}'
    check (tags <@ array['sport', 'culture', 'kids', 'free', 'food', 'rest']::text[]),
  add column opening_hours text,
  add column phone         text,
  add column website       text,
  add column is_active     boolean not null default true;

alter table public.artifact_collections add column is_active boolean not null default true;
alter table public.artifacts add column is_active boolean not null default true;

-- existing places inside the zone
update public.area_places p set tags = v.tags
from (values
  ('zav-bay', array['free', 'kids']),
  ('zav-embankment', array['free', 'kids']),
  ('zav-bridge', array['free']),
  ('zav-beach', array['free', 'kids', 'rest']),
  ('zav-yacht-club', array['sport']),
  ('zav-tsarevna', array['food']),
  ('zav-traktir', array['food']),
  ('zav-ant-trail', array['free', 'kids']),
  ('zav-sloboda-lake', array['free'])
) as v (id, tags)
where p.id = v.id;

update public.area_places
   set zone = 'resort'
 where id = 'zav-traktir';

-- «Аква & SPA» is the domed water park south of the bay (Yandex), not the SPA Village by «Царевна»
update public.area_places
   set name = '«Завидово Аква & SPA»',
       description = 'Аквапарк и спа под стеклянными куполами на берегу бухты.',
       idea = 'Отдых с детьми, финиш прогулки',
       location = extensions.st_setsrid(extensions.st_makepoint(36.519898, 56.589857), 4326)::extensions.geography,
       radius_m = 120, needs_check = true, tags = array['kids', 'rest']
 where id = 'zav-aqua-spa';

update public.area_places
   set name = '«Акватория лета»',
       description = 'Спортивный центр у воды: прокат и водные активности.',
       website = 'http://aqualeto-zavidovo.com/',
       needs_check = false, tags = array['sport', 'kids']
 where id = 'zav-water-rental';

update public.area_places
   set description = 'Теннисный корт у набережной.',
       location = extensions.st_setsrid(extensions.st_makepoint(36.51722, 56.59646), 4326)::extensions.geography,
       radius_m = 60, needs_check = false, tags = array['sport']
 where id = 'zav-tennis';

update public.area_places
   set opening_hours = 'пт–сб 09:00–23:00; вс–чт 09:00–21:00',
       phone = '+7 903 806-79-97',
       website = 'https://yatraktir.ru'
 where id = 'zav-traktir';

update public.area_places
   set description = 'Ресторан русской кухни на берегу, рядом со спа-комплексом.'
 where id = 'zav-tsarevna';

-- new places: OSM objects inside the zone (2026-10-27) and, needs_check, points from the Yandex screenshot
insert into public.area_places (id, area, zone, category, name, description, idea, address, location, radius_m,
                                is_partner, needs_check, ord, tags, opening_hours, phone, website)
select v.id, 'zavidovo', v.zone, v.category, v.name, v.description, v.idea, v.address,
       extensions.st_setsrid(extensions.st_makepoint(v.lng, v.lat), 4326)::extensions.geography,
       v.radius_m, v.is_partner, v.needs_check, v.ord, v.tags, v.opening_hours, v.phone, v.website
from (values
  ('zav-ant-trail-start', 'forest', 'Эко', 'Начало «Муравьиной тропы»',
   'Вход на тематическую тропу — круг около 230 м по лесу.', 'Начало лесного маршрута', null::text,
   56.59889, 36.52782, 60::real, false, false, 40, array['free', 'kids'], null::text, null::text, null::text),
  ('zav-radisson', 'resort', 'Отдых / отель', 'Отель Radisson Resort Zavidovo',
   'Пятизвёздочный отель на набережной главной бухты.', 'Точка интереса', 'Вараксино, Тверской бульвар, 2',
   56.59509, 36.51914, 80, false, false, 41, array['rest'], null, null, null),
  ('zav-radisson-residences', 'resort', 'Отдых / отель', 'Апартаменты Radisson Residences Zavidovo',
   'Апартаменты у причалов яхт-клуба.', 'Точка интереса', 'Вараксино, Тверской бульвар, 4',
   56.59445, 36.52129, 80, false, false, 42, array['rest'], null, null, null),
  ('zav-spa-village', 'resort', 'Отдых / спа', 'Zavidovo SPA Village',
   'Спа-отель с банными домами на берегу Шоши, рядом с рестораном «Царевна».', 'Отдых, банный ритуал',
   'Вараксино, ул. Чистый Плёс, 1', 56.60040, 36.51365, 100, false, false, 43, array['rest'],
   null, '+7 495 191-25-25', 'https://zavidovospavillage.com/'),
  ('zav-yamskaya', 'resort', 'Отдых / отель', 'Гостиница «Ямская»',
   'Гостиница в стиле ямской слободы у кемпинга и «Трактира».', 'Точка интереса', 'Вараксино, Ямская слобода, 14',
   56.59557, 36.53707, 70, false, false, 44, array['rest'], null, '+7 48242 4-98-48', 'https://yamskaya.zavidovo.com/'),
  ('zav-camping', 'resort', 'Отдых', 'Кемпинг Завидово',
   'Кемпинг у пруда: домики, площадка для барбекю, баня.', 'Отдых на природе', 'Вараксино, ул. Ямская слобода, 19',
   56.59732, 36.53570, 100, false, false, 45, array['rest', 'kids'], null, null, 'https://camping.zavidovo.com'),
  ('zav-banya', 'resort', 'Отдых', 'Русская баня',
   'Баня у пруда рядом с кемпингом.', 'Отдых', null,
   56.59642, 36.53400, 50, false, false, 46, array['rest'], null, null, null),
  ('zav-syrzavod', 'resort', 'Еда / партнёр', 'Ресторан «СырЗавод»',
   'Ресторан при сыроварне в «Ямской слободе».', 'Финиш прогулки, дегустация', 'Вараксино, ул. Ямская слобода, 18',
   56.59638, 36.53766, 60, true, false, 47, array['food'], null, null, 'https://zavidovo.com/otdyhayshim/restoran-syrzavod'),
  ('zav-zhukovka', 'resort', 'Еда / партнёр', 'Ресторан «Жуковка»',
   'Ресторан у спа-комплекса на берегу Шоши.', 'Финиш прогулки', null,
   56.600131, 36.515844, 60, true, true, 48, array['food'], null, null, null),
  ('zav-gastrobar', 'resort', 'Еда / партнёр', 'Гастробар by Simple',
   'Гастробар у южного берега бухты.', 'Финиш прогулки', null,
   56.591731, 36.523092, 60, true, true, 49, array['food'], null, null, null),
  ('zav-barhan', 'resort', 'Еда / партнёр', 'Кафе-юрта «БарХан»',
   'Кафе в юрте у лесной аллеи.', 'Финиш лесной прогулки', null,
   56.599540, 36.533706, 60, true, true, 50, array['food'], null, null, null),
  ('zav-evrika', 'resort', 'Культура / дети', '«Эврика» — студия творчества и технологий',
   'Мастерские и занятия для детей и взрослых.', 'Задание на творчество', null,
   56.594162, 36.521379, 60, false, true, 51, array['culture', 'kids'], null, null, null),
  ('zav-alpaca', 'resort', 'Семья', 'Парк альпак «Папа Мама»',
   'Контактный парк с альпаками на краю курорта.', 'Семейная точка', null,
   56.593597, 36.539613, 100, false, true, 52, array['kids'], null, null, null),
  ('zav-fishing', 'bay', 'Спорт / вода', 'Рыболовный клуб «Завидово»',
   'Рыбалка на пруду у набережной.', 'Точка интереса', null,
   56.59729, 36.51828, 70, false, false, 53, array['sport'], null, null, null),
  ('zav-minigolf', 'resort', 'Спорт / дети', 'Мини-гольф',
   'Площадка мини-гольфа у набережной.', 'Семейная игра', null,
   56.59607, 36.51666, 50, false, false, 54, array['sport', 'kids'], null, null, null),
  ('zav-basketball', 'resort', 'Спорт', 'Баскетбольная площадка',
   'Открытая площадка рядом с теннисным кортом.', 'Спортивная точка', null,
   56.59646, 36.51692, 50, false, false, 55, array['sport', 'free'], null, null, null),
  ('zav-football', 'resort', 'Спорт', 'Футбольное поле',
   'Поле в центре курорта.', 'Спортивная точка', null,
   56.59655, 36.52463, 80, false, false, 56, array['sport'], null, null, null),
  ('zav-toboggan', 'resort', 'Спорт / дети', 'Трасса для санок и тюбинга',
   'Горка у кемпинга.', 'Зимняя активность', null,
   56.59523, 36.53362, 80, false, false, 57, array['sport', 'kids'], null, null, null),
  ('zav-memorial', 'resort', 'История', 'Братская могила',
   'Воинское захоронение времён Великой Отечественной войны.', 'Минута памяти', null,
   56.59299, 36.53194, 50, false, false, 58, array['culture', 'free'], null, null, null),
  ('zav-tent', 'resort', 'Культура', 'Шатёр',
   'Шатёр для мероприятий у набережной.', 'Площадка событий', null,
   56.59503, 36.51680, 50, false, true, 59, array['culture'], null, null, null)
) as v (id, zone, category, name, description, idea, address, lat, lng, radius_m, is_partner, needs_check, ord,
        tags, opening_hours, phone, website);

-- «Лесная экспедиция» inside the zone: the «Муравьиная тропа» loop and the pond by «Ямская»
update public.route_steps set place_id = 'zav-ant-trail-start', task = 'Найди начало «Муравьиной тропы».'
 where slug = 'forest-1';
update public.route_steps set place_id = 'zav-sloboda-lake',
       task = 'У пруда у «Ямской» найди три разных природных оттенка и сфотографируй их.'
 where slug = 'forest-3';
update public.route_steps set place_id = 'zav-ant-trail' where slug = 'forest-4';
update public.quest_routes
   set description = '«Муравьиная тропа» и пруд у «Ямской»: маленькие открытия на обычной прогулке.',
       duration = '30–45 мин',
       note = 'Тропа — круг около 230 м. Не сходите с тропы и не трогайте муравейники.'
 where slug = 'zav-forest';

-- outside the zone: places off, routes that need them off, artifacts only they gave off
update public.area_places p
   set is_active = false
  from public.area_zones z
 where z.id = 'zavidovo-core' and p.area = 'zavidovo'
   and (p.location is null or not extensions.st_covers(z.boundary, p.location));

update public.quest_routes r
   set is_active = false
 where exists (
   select 1 from public.route_steps s
   join public.area_places p on p.id = s.place_id
   where s.route_id = r.id and not p.is_active
 );

update public.artifacts a
   set is_active = false
 where a.id not in ('explorer-trace', 'pioneer-map')
   and not exists (select 1 from public.quest_routes r where r.artifact_id = a.id and r.is_active)
   and not exists (
     select 1 from public.route_steps s join public.quest_routes r on r.id = s.route_id
     where s.artifact_id = a.id and r.is_active
   );

update public.artifact_collections c
   set is_active = false
 where not exists (select 1 from public.artifacts a where a.collection_id = c.id and a.is_active);

-- ---------------------------------------------------------------------------
-- area_quests: active content only, with categories and contacts
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
    'needsCheck', p.needs_check,
    'tags', to_jsonb(p.tags),
    'openingHours', p.opening_hours,
    'phone', p.phone,
    'website', p.website
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
      where p.area = p_area and p.is_active
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
                 where a.collection_id = c.id and a.is_active
               )
             ) order by c.ord), '[]'::jsonb)
      from public.artifact_collections c
      where c.area = p_area and c.is_active
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- game buildings of the zone
-- ---------------------------------------------------------------------------
create or replace function public.publish_osm_buildings_in_zone(
  p_zone text,
  p_skip_types text[] default array['garage', 'garages', 'shed', 'service', 'construction', 'hut', 'kiosk',
                                    'roof', 'carport', 'transformer_tower', 'toilets', 'greenhouse', 'ruins']
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zone public.area_zones%rowtype;
  v_created integer;
  v_hidden integer;
begin
  select * into v_zone from public.area_zones where id = p_zone;
  if not found then
    raise exception 'zone_not_found' using errcode = '22023';
  end if;

  with picked as (
    select o.*
      from public.osm_buildings o
     where extensions.st_covers(v_zone.boundary, o.centroid::extensions.geography)
       and not (coalesce(o.tags ->> 'building', 'yes') = any (p_skip_types))
  ), created as (
    insert into public.buildings (slug, name, address, district_id, location, publish_status, osm_building_id)
    select
      'osm-' || left(p.osm_type, 1) || p.osm_id,
      left(coalesce(
        p.name,
        p.address,
        case when p.tags ->> 'building' in ('house', 'detached', 'residential', 'apartments', 'terrace', 'semidetached_house')
             then 'Жилой дом' else 'Здание' end
      ), 160),
      p.address,
      null,
      p.centroid::extensions.geography,
      'published',
      p.id
    from picked p
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into v_created from created;

  -- bulk-published buildings of the same game area outside the zone (hand-made catalog entries are left alone)
  with hidden as (
    update public.buildings b
       set publish_status = 'hidden'
     where b.slug like 'osm-%' and b.publish_status = 'published'
       and v_zone.area = 'zavidovo'
       and extensions.st_y(b.location::extensions.geometry) between 56.52 and 56.62
       and extensions.st_x(b.location::extensions.geometry) between 36.48 and 36.58
       and not extensions.st_covers(v_zone.boundary, b.location)
    returning 1
  )
  select count(*)::integer into v_hidden from hidden;

  return jsonb_build_object('created', v_created, 'hidden', v_hidden);
end;
$$;

revoke execute on function public.publish_osm_buildings_in_zone(text, text[]) from public, anon, authenticated;
grant execute on function public.publish_osm_buildings_in_zone(text, text[]) to service_role;

select public.publish_osm_buildings_in_zone('zavidovo-core');
