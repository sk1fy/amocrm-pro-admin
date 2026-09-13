# Локальный запуск

Инструкция для разработчика/агента. Стек Admin API, frontend и
fixture-адаптер для e2e работают. Все команды выполняются из корня
соответствующего репозитория.

## Требования

- Docker с Docker Compose v2 и `make`. На macOS проверено с Colima.
- Свободное место в Docker VM: не менее 10 ГБ. Полный диск ломает
  PostgreSQL пилота (`PANIC: could not write … No space left on device`,
  бесконечный recovery). Проверка: `docker system df`; в Colima —
  `colima ssh -- df -h /var/lib/docker`.
- Node и Go на хосте не обязательны: канонические проверки идут в Docker.

## Core: пилотный стек amocrm-pro

```sh
cd ../amocrm-pro
make activity-up                     # api, worker, activity, crm-events, postgres
docker compose -f docker-compose.activity.yml ps
curl --fail http://127.0.0.1:18082/ready
```

Порты хоста: публичный API `127.0.0.1:18080`, management `127.0.0.1:18082`,
admin listener (после части 1.1) `127.0.0.1:18083`. Все — loopback.

Admin listener включается переменными `ADMIN_HTTP_ADDRESS=:8083` и
`ADMIN_API_TOKEN` в `docker-compose.activity.yml`; без обеих listener не
стартует. Проверка после реализации:

```sh
curl --fail -H "Authorization: Bearer $ADMIN_API_TOKEN" \
     -H 'X-Admin-Actor: employee:local-check' \
     http://127.0.0.1:18083/admin/v1/backend
```

### Интеграции для пилота

Пилотная Core DB после `activity-up` пуста. Интеграции создаются только
через audited CLI (реальный путь кода, секрет через stdin):

```sh
printf '%s' 'fixture-secret-a' > /tmp/fixture-a.secret
docker compose -f docker-compose.activity.yml run --rm -T integrations create \
  --actor fixture@example.invalid --code fixture-widget-a \
  --client-id 0f1a0001-0000-4000-8000-000000000001 \
  --redirect-uri https://backend.example.invalid/oauth/amocrm/callback \
  --webhook-events add_lead,status_lead --services lead-status,activity \
  --secret-stdin < /tmp/fixture-a.secret
rm /tmp/fixture-a.secret
```

Повторить для `fixture-widget-b` (`--client-id …0002`, `--services
lead-status`). Реальная установка требует OAuth с настоящим amoCRM: для неё
нужна настоящая интеграция и `PUBLIC_BASE_URL`, доступный из интернета.

### Fixture-установки

Когда реальных установок нет, применяется помеченный fixture из этого
репозитория (`deploy/fixtures/core-installations.sql`): 6 аккаунтов, два
виджета на аккаунт в двух случаях, все состояния подключений/webhook/jobs,
`settings.origin = "fixture"`, `audit_log.actor_type = 'fixture'`, домены
`*.amocrm.test` / `*.kommo.test`, без `oauth_credentials`.

```sh
cd ../amocrm-pro-admin
make fixtures-core-dry-run                     # BEGIN … ROLLBACK, только проверка
make fixtures-core FIXTURES_CONFIRM=core-pilot # применить к пилотному стеку
```

Fixture идемпотентен (фиксированные UUID, `ON CONFLICT DO NOTHING`) и падает с
понятной ошибкой, если интеграции не созданы. SQL передаётся в `psql` через
stdin (`-f -`), поэтому путь к файлу не нужен внутри контейнера. Проверено на
пилотном стеке 2026-09-12: `fixtures-core-dry-run` и `fixtures-core` применили
8 установок, 6 задач, попытки и аудит; Admin API показал 6 аккаунтов с
`origin=fixture` и `sources: core: available`.

Удаление fixture (при необходимости, только dev-стек):

```sql
DELETE FROM installations WHERE settings->>'origin' = 'fixture';
-- jobs/audit_log ссылаются ON DELETE SET NULL; при желании очистить:
DELETE FROM jobs WHERE id::text LIKE 'f1b00000-%';
DELETE FROM audit_log WHERE actor_type = 'fixture';
```

## Admin: стек админки

Необязательные `GRAFANA_BASE_URL` и `LOKI_BASE_URL` (абсолютные URL).
Пустые значения допустимы: ссылок в UI не будет. Идентификаторы
аккаунта/установки попадают только в query ссылки, не в labels
Prometheus.

`make up` поднимает PostgreSQL, мигратор, Admin API и frontend
(nginx на `http://127.0.0.1:5173`, прокси `/api` на Admin API). Compose
выставляет `TRUST_PROXY_HEADERS=true`, потому что перед API всегда стоит
nginx и передаёт `X-Real-IP`/`X-Forwarded-For`; при прямом доступе к `:8090`
без прокси переменная должна быть `false`
([ADR-0006](../adr/0006-trusted-proxy-headers.md)).

```sh
cp .env.example .env            # CORE_ADMIN_API_TOKEN нужен для core-http
make config
make up                          # admin-postgres, migrate, admin-api, frontend
make migrate                     # при необходимости повторно
```

Первый администратор (пароль только через stdin):

```sh
printf '%s' 'choose-a-strong-password' | \
  docker compose -f deploy/docker-compose.yml run --rm -T admin-cli \
  employee create --email admin@example.invalid --name "Admin" --role admin --password-stdin
```

Вход в интерфейс: открыть `http://127.0.0.1:5173`, email
`admin@example.invalid`, пароль тот, что передан в CLI.

Проверка входа прямым запросом к API (мутации требуют CSRF-заголовки):

```sh
curl -sS -D - -o /tmp/admin-login.json \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: admin-ui' \
  -H 'Origin: http://127.0.0.1:5173' \
  -d '{"email":"admin@example.invalid","password":"choose-a-strong-password"}' \
  http://127.0.0.1:8090/api/v1/auth/login
curl --fail http://127.0.0.1:8092/live
```

Admin API: `http://127.0.0.1:8090/api/v1`, management `127.0.0.1:8092`,
интерфейс `http://127.0.0.1:5173`. Для локальной разработки UI без
сборки образа: `cd frontend && npm run dev` (Vite проксирует `/api` на
`:8090`).

Сквозные сценарии против fixture-адаптера (не входят в `make check`):

```sh
make e2e
```

Стек e2e изолирован портами (`E2E_POSTGRES_PORT=5434`,
`E2E_FRONTEND_PORT=5174`, `E2E_HTTP_PORT=8094`, `E2E_MANAGEMENT_PORT=8095`)
и может работать одновременно с dev-стеком.

Демонстрационный сценарий экранов:
[demo-stage-1.md](demo-stage-1.md).

## Этап 4: второй бекенд, метрики, эксплуатация

Второй бекенд уже в dev-стеке: `deploy/backends.yaml`, код `fixture`
(`kind: fixture`, `profile: module`) — тестовые данные с
`origin=fixture`, свои аккаунты и подключение на `91000002`. Отключить:
удалить блок `fixture` из `deploy/backends.yaml` и перезапустить
admin-api (`docker compose -f deploy/docker-compose.yml restart
admin-api`) — `core` при этом не затрагивается. Подключение своего
модуля — [new-module.md](new-module.md).

Метрики на management listener (только внутренняя сеть):

```sh
curl -s http://127.0.0.1:8092/metrics | grep '^admin_'
```

Семейства и labels — [operator.md](operator.md), раздел 11.

Эксплуатационные команды; детали и prod-процедуры — в
[operator.md](operator.md):

```sh
make backup-db                                    # дамп в backups/
make restore-check RESTORE_CONFIRM=restore-check  # новая БД
docker compose -f deploy/docker-compose.yml --profile tools run --rm \
  -T admin-cli prune --audit-before 2025-09-13    # dry-run
make bench-admin                                  # 10^4/10^5
```

Нагрузочные данные — `deploy/fixtures/load-core-installations.sql`
(scratch-БД пилота), результаты и EXPLAIN —
[../reviews/stage-4-load-2026-09-13.md](../reviews/stage-4-load-2026-09-13.md).
Демонстрация этапа 4 — [demo-stage-4.md](demo-stage-4.md).

## Проверки

```sh
make docs-check        # работает сейчас
make check             # docs-check + lint + test + integration-test (после 1.2)
cd ../amocrm-pro && make fmt-check vet test openapi-check integration-test
```

## Типовые проблемы

| Симптом | Причина | Действие |
| --- | --- | --- |
| `FATAL: the database system is in recovery mode` у пилота, в логах `No space left on device` | Диск Docker VM заполнен | Освободить место (`docker system df`, `docker image prune`, удалить неиспользуемые volumes — с подтверждением владельца), затем `docker compose -f docker-compose.activity.yml restart postgres` |
| Контейнеры пилота `unhealthy` | Зависят от postgres | Дождаться `pg_isready`, при необходимости `restart` |
| Admin API отвечает `backend_unavailable` для `core` | Listener не включён или токен не совпадает | Проверить `ADMIN_HTTP_ADDRESS`/`ADMIN_API_TOKEN` в compose пилота и `CORE_ADMIN_API_TOKEN` в `.env` |
| Fixture: `fixture integrations are missing` | Интеграции не созданы через CLI | Выполнить раздел «Интеграции для пилота» |
