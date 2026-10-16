# Метка

Мобильная геоигра: найдите реальное здание на карте, подойдите к нему, сфотографируйте фасад и откройте его в коллекции. Одна кодовая база для iOS, Android и веба (Vue 3 + Capacitor), бэкенд — Supabase (Postgres + PostGIS + pgvector).

Состояние проекта, проверки и блокеры — в [PROJECT_STATUS.md](PROJECT_STATUS.md). Архитектура: [ADR-001 распознавание](docs/ADR-001-building-recognition.md), [ADR-002 серверная логика](docs/ADR-002-server-game-logic.md).

## Запуск

```bash
npm install
cp .env.example .env        # укажите VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY
npm run dev
```

База данных: примените `supabase/migrations/*` к проекту Supabase (`supabase db push`). Для локальной разработки примените также `supabase/seed.sql`, но **никогда не применяйте его в production**.

Подтверждение почты кодом: в Supabase → Authentication → Email Templates → «Confirm signup» добавьте в письмо `{{ .Token }}` (код) рядом с `{{ .ConfirmationURL }}` (ссылка). Без этого работает только ссылка.

Без обученной модели (`VITE_RECOGNITION_MODEL_URL`) сканер сообщает, что распознавание недоступно. Чтобы пройти игровой цикл в разработке, задайте `VITE_USE_MOCKS=true`. Тогда камера, GPS и распознавание симулируются, а проверка на сервере остаётся настоящей и работает только с dev-моделью из seed.

## Проверки

```bash
npm run typecheck   # vue-tsc
npm test            # unit + БД (PGlite: PostgreSQL 18 + PostGIS + pgvector)
npm run build
npx cap sync        # затем: npx cap open android | ios
```

Для нативных сборок нужны Android Studio (JDK 21, SDK 36) и Xcode на macOS.

## Инструкции для Claude Code
`CLAUDE.md` — правила работы, `TASK_TEMPLATE.md` — шаблон постановки задачи.
