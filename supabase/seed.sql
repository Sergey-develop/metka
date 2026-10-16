-- LOCAL DEVELOPMENT SEED ONLY. Never run against production.
-- Districts (real Moscow okrugs) come from migration 20261015000003.
-- Building coordinates are approximate positions of well-known public landmarks;
-- all rows are flagged is_dev_seed = true and have no verified address.
-- Recognition model 'mock-dev-v1' and its embeddings are synthetic and exist
-- only so the scan flow can be exercised with the explicit dev mock recognizer.

insert into public.buildings
  (id, slug, name, description, district_id, location, scan_radius_m, rarity,
   reward_xp, reward_coins, reward_influence, is_dev_seed) values
  ('00000000-0000-4000-b000-000000000001', 'bolshoi-theatre', 'Большой театр', 'Исторический театр на Театральной площади.',
   '00000000-0000-4000-a000-000000000001', 'SRID=4326;POINT(37.6186 55.7601)', 120, 'epic', 200, 50, 40, true),
  ('00000000-0000-4000-b000-000000000002', 'gum', 'ГУМ', 'Торговый комплекс на Красной площади.',
   '00000000-0000-4000-a000-000000000001', 'SRID=4326;POINT(37.6215 55.7547)', 120, 'rare', 120, 30, 25, true),
  ('00000000-0000-4000-b000-000000000003', 'historical-museum', 'Исторический музей', 'Здание музея на Красной площади.',
   '00000000-0000-4000-a000-000000000001', 'SRID=4326;POINT(37.6178 55.7553)', 100, 'rare', 120, 30, 25, true),
  ('00000000-0000-4000-b000-000000000004', 'pashkov-house', 'Дом Пашкова', 'Классицистическая усадьба на Ваганьковском холме.',
   '00000000-0000-4000-a000-000000000001', 'SRID=4326;POINT(37.6087 55.7495)', 100, 'epic', 200, 50, 40, true),
  ('00000000-0000-4000-b000-000000000005', 'tsum', 'ЦУМ', 'Универмаг на Петровке.',
   '00000000-0000-4000-a000-000000000001', 'SRID=4326;POINT(37.6205 55.7612)', 80, 'common', 50, 10, 10, true),
  ('00000000-0000-4000-b000-000000000006', 'kievsky-station', 'Киевский вокзал', 'Вокзал с часовой башней.',
   '00000000-0000-4000-a000-000000000002', 'SRID=4326;POINT(37.5665 55.7432)', 150, 'rare', 120, 30, 25, true),
  ('00000000-0000-4000-b000-000000000007', 'hotel-ukraina', 'Гостиница «Украина»', 'Одна из семи сталинских высоток.',
   '00000000-0000-4000-a000-000000000002', 'SRID=4326;POINT(37.5662 55.7516)', 150, 'legendary', 400, 100, 80, true),
  ('00000000-0000-4000-b000-000000000008', 'msu-main', 'Главное здание МГУ', 'Высотка на Воробьёвых горах.',
   '00000000-0000-4000-a000-000000000002', 'SRID=4326;POINT(37.5308 55.7033)', 250, 'legendary', 400, 100, 80, true),
  ('00000000-0000-4000-b000-000000000009', 'ras-presidium', 'Президиум РАН', 'Здание с «золотыми мозгами» на Ленинском проспекте.',
   '00000000-0000-4000-a000-000000000003', 'SRID=4326;POINT(37.5768 55.7105)', 150, 'rare', 120, 30, 25, true),
  ('00000000-0000-4000-b000-000000000010', 'gagarin-monument', 'Площадь Гагарина', 'Монумент и ансамбль площади.',
   '00000000-0000-4000-a000-000000000003', 'SRID=4326;POINT(37.5838 55.7077)', 120, 'common', 50, 10, 10, true);

-- synthetic recognition model: building N is represented by basis vector e_N
insert into public.recognition_models (version, embedding_dim, score_threshold, margin_threshold, max_plausible_score, is_active)
values ('mock-dev-v1', 16, 0.80, 0.10, 0.995, true);

insert into public.building_reference_embeddings (building_id, model_version, embedding, source)
select b.id, 'mock-dev-v1',
       (select array_agg(case when i = n then 1.0 else 0.0 end order by i)
          from generate_series(1, 16) as i)::extensions.vector,
       'synthetic'
from (
  select id, right(id::text, 2)::integer as n
  from public.buildings where is_dev_seed
) b;

insert into public.quests (id, slug, title, description, kind, target, district_id, rarity, reward_xp, reward_coins) values
  ('00000000-0000-4000-c000-000000000001', 'first-mark', 'Первая метка', 'Откройте первое здание.', 'discover_count', 1, null, null, 50, 20),
  ('00000000-0000-4000-c000-000000000002', 'explorer-5', 'Исследователь', 'Откройте 5 зданий.', 'discover_count', 5, null, null, 200, 80),
  ('00000000-0000-4000-c000-000000000003', 'center-3', 'Сердце города', 'Откройте 3 здания в центре.', 'discover_in_district', 3,
   '00000000-0000-4000-a000-000000000001', null, 150, 50),
  ('00000000-0000-4000-c000-000000000004', 'legend-1', 'Легенда', 'Откройте легендарное здание.', 'discover_rarity', 1, null, 'legendary', 300, 100);

-- keep building -> okrug assignment consistent with real boundaries
update public.buildings b
   set district_id = d.id
  from public.districts d
 where extensions.st_covers(d.boundary, b.location)
   and b.district_id is distinct from d.id;
