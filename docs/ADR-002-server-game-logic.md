# ADR-002. Игровая логика на сервере: Postgres RPC вместо Edge Functions

Статус: принято для MVP · 2026-10-15

## Решение

Все изменения игрового состояния (приём скана, коллекция, XP, монеты, влияние, задания, кланы) выполняются в `SECURITY DEFINER`-функциях PostgreSQL (`supabase/migrations/*_game_functions.sql`), вызываемых клиентом через `supabase.rpc()`. Клиентские роли имеют только `SELECT` по RLS и `UPDATE` трёх косметических колонок профиля.

## Почему не Edge Functions

- **Атомарность.** Скан → коллекция → награда → влияние → задания — одна транзакция. Edge Function всё равно делала бы несколько запросов к БД с service-ключом, и атомарность пришлось бы обеспечивать отдельной SQL-функцией.
- **Идемпотентность через ограничения БД:** `UNIQUE (user_id, client_request_id)` в `building_scans`, `UNIQUE (user_id, building_id)` в `player_buildings`, `UNIQUE (user_id, source_type, source_id)` в `reward_ledger`. Повтор запроса и гонки двух запросов не начисляют награду дважды.
- **Нет service_role-ключа вне БД.** Функции берут пользователя из `auth.uid()` (JWT), а не из параметров.
- **Проверяемость.** Миграции и функции проверены тестами на реальном PostgreSQL 18 + PostGIS + pgvector (PGlite, `tests/db`).

## Когда понадобятся Edge Functions

Серверный ONNX-инференс по загруженному фото (фаза 2 ADR-001), проверка Play Integrity / App Attest, интеграции с внешними API — всё, что требует внешних вычислений или секретов. Им будет нужна та же модель данных и те же RPC.

## Правила

- `set search_path = ''`, все имена полностью квалифицированы (защита SECURITY DEFINER от подмены объектов).
- `revoke execute on all functions … from public, anon, authenticated`, затем явный `grant` только публичному API. Внутренние функции (`_advance_quests`, `_validated_embedding`) клиенту недоступны.
- Формула уровня — `public.level_for_xp`; клиентское зеркало `src/features/progression/levels.ts` сверяется тестом.
