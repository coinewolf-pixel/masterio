# Masterio

Маркетплейс срочных и бытовых услуг: приложение клиента **Masterio**, приложение мастера **Masterio Pro**, веб-CRM и сервер.
Masterio — цифровой посредник: связывает клиентов и независимых мастеров и сама услуги не выполняет.

Готовы **фаза 1** (архитектура), **фаза 2** (сервер), **фаза 3** (приложение мастера Masterio Pro), **фаза 4** (приложение клиента Masterio с живой картой), **фаза 5** (веб-CRM для админов), **фаза 6** (споры, «клиент не вышел», происшествия, поддержка, юридические документы и согласия, страховки и сроки документов, GDPR, месячные бонусы) и **фаза 7** (команды и помощники: приглашения, режим участника, назначение и замена исполнителя с согласием клиента, «пришёл другой человек»). Все фазы плана готовы. Запуск в Армении — по шагам в `docs/LAUNCH.md`.

## Как разложить архивы в одну папку

Каждая часть приходит отдельным архивом. Распакуйте их в одну папку `masterio/`:

```bash
mkdir masterio && cd masterio
unzip ../masterio-api-phase-7.zip       # корневые файлы, apps/api, CI, docker-compose
unzip ../masterio-shared-phase-7.zip    # packages/shared
unzip ../masterio-worker-phase-7.zip    # apps/worker (Masterio Pro)
unzip ../masterio-client-phase-7.zip    # apps/client (Masterio)
unzip ../masterio-admin-phase-7.zip     # apps/admin (CRM)
unzip ../masterio-docs-phase-7.zip      # docs/
```

Должно получиться:

```
masterio/
├── package.json  pnpm-workspace.yaml  pnpm-lock.yaml  tsconfig.base.json
├── docker-compose.yml  railway.json  .github/workflows/{ci,release-apps}.yml
├── apps/api/            ← masterio-api
├── apps/worker/         ← masterio-worker (Masterio Pro)
├── apps/client/         ← masterio-client (Masterio)
├── apps/admin/          ← masterio-admin (CRM)
├── packages/shared/     ← masterio-shared
└── docs/                ← masterio-docs
```


## Локальный запуск

Нужны Node.js 22+, pnpm 10 (`corepack enable`), Docker.

```bash
docker compose up -d                       # Postgres 16 + PostGIS, Redis 7, MinIO
pnpm install
cp apps/api/.env.example apps/api/.env     # заполните JWT_ACCESS_SECRET и PII_ENCRYPTION_KEY
pnpm --filter @masterio/shared build
pnpm --filter @masterio/api prisma:deploy  # миграции
pnpm --filter @masterio/api seed           # категории, города, первый superadmin
pnpm --filter @masterio/api dev            # http://localhost:3000/api/v1, Swagger: /docs
```

В `.env` для разработки `SMS_PROVIDER=console` — код из SMS печатается в лог сервера.

## Проверки

```bash
pnpm i18n:check     # все ключи во всех 5 языках
pnpm typecheck
pnpm lint
pnpm test           # unit + e2e с настоящими Postgres/PostGIS и Redis
```

E2E-тесты используют отдельную базу и отдельную базу Redis. Один раз создайте базу и задайте адреса:

```bash
docker compose exec postgres createdb -U masterio masterio_test
export TEST_DATABASE_URL=postgresql://masterio:masterio@localhost:5432/masterio_test
export TEST_REDIS_URL=redis://localhost:6379/1
```

Перед запуском тесты сами очищают схему и применяют миграции. CI в GitHub Actions поднимает Postgres и Redis сам.

## Приложения

Запуск, сборка APK/AAB и iOS, настройка push и карт — в `apps/client/README.md` (Masterio) и `apps/worker/README.md` (Masterio Pro). CRM: вход, права, деплой — `apps/admin/README.md`.

## Деплой

Сервер разворачивается на Railway — инструкция в `apps/api/README.md`.
