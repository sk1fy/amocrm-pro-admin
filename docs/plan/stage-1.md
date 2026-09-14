# Этап 1. Основа приложения и просмотр аккаунтов

> Статус: завершён. Документ сохранён как исторический план и отчёт приёмки;
> текущий backlog находится в [README](README.md).

**Цель:** рабочая админка для поиска аккаунтов и первичной диагностики: вход,
роли, поиск, карточка аккаунта и подключения, история и ошибки, честные
состояния и свежесть.

**Результат:** команда просматривает и диагностирует пилотные аккаунты
доступного Core. Команд (изменений) нет.

## Проектирование — выполнено

Документы основы уже созданы и являются входом этапа: [architecture.md](../design/architecture.md),
[screens.md](../design/screens.md), [states.md](../design/states.md),
[data-sources.md](../design/data-sources.md), [roles.md](../design/roles.md),
[admin-api.md](../design/admin-api.md), [backend-adapter.md](../design/backend-adapter.md),
ADR 0001–0004. Перед реализацией — сверка с актуальным кодом и фиксация версий
библиотек (см. ниже).

## Объём

Дополнение 2026-09-13: исправление 10 замечаний
[повторной проверки](../reviews/stage-1-2026-09-13.md) относительно
Core `11110d4` и Admin `ab3c998`. Объём: изоляция сессий frontend,
production-токен Core, гранты продукта и диагностические факты карточек,
курсорная история и операции аккаунта, недоступность наблюдений/total,
последние доставки Activity. Миграции БД не требуются.


Сверка с `amocrm-pro/main` на 2026-09-12:

- [x] Коммит `amocrm-pro`, относительно которого делается работа:
      `76e89ef0d374706e28ba8de0a682504d081242a4`
      (`deploy: track existing Core Activity overlay and verified stage progress`).
- [x] Расхождения с «Фактами о бекенде» из [README](README.md):
      факты подтверждены (Go 1.25, PostgreSQL 17, chi v5, pgx v5, статусы
      установок/webhook/jobs, outbox `expired` из миграции `000014`,
      `apicontract.Routes` vs OpenAPI, отсутствие HTTP-списков,
      `testkit.Reset` без `activity_pilots` /
      `installation_webhook_destinations` / `integration_services`).
      Уточнения, не ломающие план:
      - `ListDeliveries` не фильтрует по `installation_id` и отдаёт только
        `failed`/`expired`; CLI не меняем — добавляем
        `ListDeliveriesFiltered`.
      - `installations.settings` в проде не пишется; метка `fixture`
        живёт в `settings.origin` только у SQL-fixture админки
        (как в `data-sources.md`).
      - `client_secret_key_version` читаем, в JSON отдаём как
        `key_version` (ключ с подстрокой `secret` в ответах запрещён).
      - Listener выключен, если `ADMIN_HTTP_ADDRESS` и `ADMIN_API_TOKEN`
        оба пусты; одна переменная без другой — ошибка старта.
      В `data-sources.md` правок не требуется.
- [x] Зафиксированные версии (`npm view` 2026-09-12; Go — `go.mod` Core):
      Go `1.25.0`, PostgreSQL `17`, React `19.3.0`, Vite `8.3.0`,
      TanStack Router `1.170.35`, TanStack Query `5.102.8`,
      TypeScript `5.9.2` (в `npm view` на дату сверки значилась `7.0.2`, но
      `tsc` 7.x на тот момент не установился с `typescript-eslint` 8.43;
      фактически закреплён `5.9.2`), Vitest `5.0.0`, Playwright `1.63.0`.
      Записываются в `frontend/package.json` в части 1.4.

## Части этапа (в порядке выполнения)

Каждая часть — законченный вертикальный срез с проверками. Не начинать
следующую, пока текущая не проходит `make check` в обоих репозиториях.

### Часть 1.1. Core admin read listener (`amocrm-pro`)

Ветка `feature/admin-read-api`.

1. `internal/platform/config`: `ADMIN_HTTP_ADDRESS`, `ADMIN_API_TOKEN`;
   валидация непересечения адресов; пустые значения → listener выключен.
2. `internal/apicontract`: `AdminRoutes` (отдельно от `Routes`), маршруты из
   [admin-api.md](../design/admin-api.md#core-admin-read-v1-amocrm-pro-listener-admin_http_address).
3. `internal/adminread`: middleware (Bearer с `subtle.ConstantTimeCompare`,
   обязательный `X-Admin-Actor`), обработчики, запросы, маппинг состояния
   авторизации, envelope ошибок, `observed_at`.
   - Переиспользовать `activitybridge.ListDeliveries`/`InspectDelivery`
     (добавить фильтр по `installation_id` без изменения CLI).
   - `GET /admin/v1/backend` собирает `buildinfo.Revision`,
     `services.Components()` и, при наличии, каталог `componentruntime`.
4. `cmd/api/main.go`: третий `httpserver` при включённой конфигурации;
   `httpserver.RunAll` уже принимает несколько серверов.
5. `api/admin-openapi.yaml` + `api/admin_openapi_test.go`.
6. Dockerfile: добавить `./internal/adminread` в `CMD` stage
   `integration-test`.
7. Compose: `docker-compose.activity.yml` — env и порт `127.0.0.1:18083`;
   `docker-compose.yml` — то же с `ADMIN_PORT` по умолчанию `8083`.
8. Docs: `docs/adr/0025-admin-read-listener.md`, раздел в
   `docs/architecture.md`, таблица портов в `README.md`, runbook
   `docs/runbooks/admin-read-api.md` (включение, токен, что не отдаётся).
9. Проверки: `make fmt-check vet test openapi-check integration-test`,
   `docker compose -f docker-compose.activity.yml config --quiet`.

Приёмка части: `curl -H 'Authorization: Bearer …' -H 'X-Admin-Actor: employee:test'
http://127.0.0.1:18083/admin/v1/backend` отвечает; без токена — 401; ключи
ответов установок не содержат `ciphertext`, `token`, `secret`, `key_hash`.

### Часть 1.2. Скелет Admin API и вход сотрудников (`amocrm-pro-admin/backend`)

1. Go-модуль, `Makefile` (Docker-first: `build`, `up`, `down`, `test`,
   `lint`, `migrate`, `check`), `Dockerfile` (multi-stage, distroless/alpine,
   non-root), `deploy/docker-compose.yml` (admin-postgres, admin-api,
   frontend), `.env.example`.
2. Миграции admin DB (`backend/migrations`, формат `NNNNNN_name.up/down.sql`,
   мигратор — собственный минимальный на pgx с таблицей `schema_migrations` и
   контрольными суммами по образцу Core или `golang-migrate` в Docker; решение
   записать в ADR-0005): `employees`, `sessions`, `admin_audit_log`.
3. `platform/httpx` (envelope, request id, recover, access log), `auth`
   (argon2id, сессии, cookie, CSRF, rate limit входа), `rbac`, `employees`,
   `audit`.
4. `cmd/admin-cli employee create|set-role|disable|revoke-sessions`
   (пароль через stdin).
5. Маршруты: `auth/login`, `auth/logout`, `me`, `me/sessions`,
   `system/employees*`, `system/audit`.
6. Тесты: unit (пароли, сессии, RBAC-матрица из `roles.md` как таблица),
   integration с PostgreSQL в Docker (`*_integration_test.go`).

Приёмка части: вход/выход работают; `viewer` получает 403 на
`POST /system/employees`; смена роли отзывает сессии; аудит содержит вход,
выход, изменения сотрудников.

### Часть 1.3. Адаптер Core и чтение аккаунтов (`backend`)

1. `adapter` (типы, ошибки, `Observation`), `adapter/core` (HTTP-клиент с
   таймаутом, токеном из env, `X-Admin-Actor`, маппинг состояний → словарь,
   `Raw`), `adapter/fixture` (минимум для unit-тестов агрегации).
2. `catalog` из `deploy/backends.yaml`; `accounts.Service` — параллельный
   опрос, `sources[]`, объединение по `account_id`, нормализация `q`
   (ID / поддомен / домен / ссылка).
3. Маршруты: `accounts*`, `connections*`, `integrations*`,
   `operations/jobs*`, `system/backends`, `catalog`.
4. Тесты: нормализация поиска (табличный), маппинг каждого бекендного
   значения, частичная доступность (один адаптер падает — ответ содержит
   `sources` с `unavailable` и данные остальных), пагинация, отсутствие
   секретных ключей в JSON (рекурсивная проверка ключей).

### Часть 1.4. Frontend: вход, навигация, аккаунты

1. `frontend/` (Vite, TS strict, ESLint + Prettier, Vitest, Playwright),
   nginx-конфиг с прокси `/api`.
2. Слой API-клиента (fetch, envelope, 401 → `/login?next=`), `Observation`
   и `StatusBadge` из словаря состояний, `DataTable`, `FilterBar`,
   `EmptyState`, `ErrorState`, баннер `SourcesBanner`.
3. Экраны: Вход, Обзор (минимум), Аккаунты (поиск, фильтры в URL, пагинация),
   Карточка аккаунта (Обзор, Виджеты), Карточка подключения.
4. Playwright: вход → поиск по трём форматам → карточка → подключение →
   прямая ссылка после перезагрузки.

### Часть 1.5. Остальные экраны чтения

Операции (вкладка аккаунта и глобальный список), История, Виджеты (список и
карточка интеграции), Система (бекенды, сотрудники, мои сессии, аудит).

### Часть 1.6. Данные для пилота и демонстрация

- Реальный путь: `integrations create` через CLI пилотного стека для 1–2
  интеграций (`--services lead-status`, `activity`); OAuth реальной установки
  — при наличии тестового аккаунта amoCRM у команды.
- Fixture-путь (если реальных установок нет): SQL-fixture
  `deploy/fixtures/core-installations.sql` для пилотного стека, вставляющий
  установки с `settings = '{"origin":"fixture"}'`, без `oauth_credentials`
  или с заведомо недействительным ciphertext **не требуется** — достаточно
  отсутствия credentials (`authorization.state = missing`), несколько статусов
  и webhook-состояний, несколько интеграций на один `account_id`, пару jobs
  с попытками и записи `audit_log` с `actor_type = 'fixture'`. Fixture
  применяется только к dev-стеку явной командой `make fixtures-core`, никогда
  в production.
- Инструкция запуска `docs/runbooks/local-run.md` и демонстрационный сценарий
  `docs/runbooks/demo-stage-1.md`.

## Приёмка этапа

- [x] Аккаунт находится по ID, поддомену, домену и полной ссылке
      (Playwright + табличный тест нормализации `q`).
- [x] Несколько виджетов одного аккаунта показаны отдельно; состояние одного
      не подменяет состояние другого (агрегация 91000002 + e2e бейджи).
- [x] `viewer` не может выполнить изменение прямым вызовом API (403 на
      `POST /system/employees`); `employees:*` только у `admin`.
- [x] Недоступность источника: адаптер с ошибкой даёт `sources.unavailable`
      и баннер; вход и сотрудники не зависят от Core. Живая остановка
      контейнера `api` пилота выполнена 2026-09-13: `sources: core:
      unavailable`, `total: null`, баннер, после рестарта данные вернулись.
- [x] Свежесть (`observed_at`) видна у блоков данных (`<time>` в e2e);
      карточка аккаунта использует наблюдение адаптера, а не `updated_at`
      строки, и не подменяет свежесть на `fresh` при отсутствии времени.
- [x] Пагинация: курсор стабилен, `limit` > 100 обрезается (integration в
      оба репозитория); пост-фильтры применяются до пагинации через
      ограниченный скан (ADR-0007), `total` точен при завершённом скане.
- [x] Ответы Core admin read и Admin API не содержат ключей с `secret`,
      `token`, `ciphertext`, `key_hash` (автотест; JSON `credential_version`).
- [x] Фильтры и курсор в URL; прямая ссылка на аккаунт и подключение после
      входа (e2e `next=` и reload). Ссылка на подключение из списка jobs.
- [x] Метка `fixture` / «тестовые данные» на тестовых данных.
- [x] `make check` зелёный локально в обоих репозиториях, `make e2e`
      зелёный после переработки UI. CI GitHub не гонялся: ветки не пушились.

## Отчёт

Дата: 2026-09-13. Коммиты: amocrm-pro-admin
`70addb0` (frontend), `21e83fb` (admin-api), `d57292d` (deploy), docs —
этот коммит; amocrm-pro `7dd571f` (build), `11110d4` (admin read).
Предыдущая версия отчёта: amocrm-pro-admin
`3dce06a433fab0f457a4c6ef32d15b1c981f2b53`, amocrm-pro
`219504b3598cc74b5e6cbedc5dd20b8f39d135ab`.

### Реализованные экраны и операции

- Вход, Обзор, Аккаунты, карточка аккаунта (Обзор / Виджеты / Операции /
  История), карточка подключения, Виджеты и карточка интеграции,
  глобальные Операции, Система (бекенды, сотрудники, сессии, аудит).
- Операций изменения Core нет (этап 2). Изменения сотрудников:
  create / patch / revoke-sessions (роль admin).
- Интерфейс переработан по мокапу: сайдбар с группами и пользователем,
  топбар с хлебными крошками и off-canvas меню, панели, таблицы, чипы
  состояний, активация вкладок; шрифты Manrope/JetBrains Mono
  самохостятся (`@fontsource-variable`, без внешних CDN). Логика,
  состояния и тексты словаря не менялись, e2e-контракт сохранён.

### Закрытие замечаний аудита (2026-09-13)

- `job_failures` был мёртвым: `ConnectionSummary` не несла jobs. Core
  отдаёт `recent_failed_jobs` (failed/dead за 24 ч), агрегат и карточка
  считают проблемы по этому факту; то же для `webhook_error` и
  `missing_credentials` — Core отдаёт `webhook_status` и
  `authorization_state`. Счётчики Обзора стали точными (`total`), при
  недоступном источнике — «—».
- Убран скрытый `fresh`: карточка аккаунта берёт `observed_at`/`freshness`
  наблюдения адаптера; при отсутствии времени — `unknown`, не `fresh`.
- Ограниченный скан пост-фильтров до пагинации (ADR-0007) вместо фильтрации
  страницы; `limit=101` обрезается, покрыто integration-тестом.
- Частичная доступность: тесты на ошибку, таймаут и отсутствие capability.
- Rate limit и аудит за nginx: `TRUST_PROXY_HEADERS` (ADR-0006), nginx
  передаёт один `X-Forwarded-For`.
- Дыры screens.md закрыты: раскрытие попыток jobs, подключения на карточке
  интеграции, вкладка «Виджеты» — отдельная таблица, total на Обзоре,
  `observed_at` в списках, фильтры операций аккаунта.
- Ложь в отчёте исправлена: TypeScript `5.9.2` (не `7.0.2`), job_failures
  работает, старые SHA заменены фактическими.
- Инфраструктурный дефект: legacy-сборщик Docker переиспользовал COPY-слои,
  из-за чего тесты и `make integration-test` в admin шли на старом коде
  (в admin цель вообще не собирала образ). Добавлены стадия-бамп
  `BUILD_REVISION`, сборка в `integration-test` и content-hash рабочего
  дерева (коммиты `7dd571f`, `d57292d`).

### Часть 1.6: данные пилота (выполнено 2026-09-13)

- Пилотный Core пересобран с admin listener (порт `127.0.0.1:18083`).
- Интеграции `fixture-widget-a`/`fixture-widget-b` созданы audited CLI
  (`integrations create`, секреты через stdin).
- `make fixtures-core-dry-run` и `make fixtures-core
  FIXTURES_CONFIRM=core-pilot` применены: 8 установок, 2 activity pilot,
  6 jobs, 9 попыток, аудит с `actor_type = 'fixture'`.
- Проверено сквозным путём: Admin API → Core admin listener отдаёт
  6 аккаунтов `origin=fixture`, `sources: core: available`; вход,
  карточка `91000002` с двумя подключениями (`reauth_required` и
  `active`), подключение `fixture-widget-a` (`missing` + `unverified`).
- Исправлены помешавшие запуску дефекты: `fixtures-core*` передавали
  host-путь в `psql` внутри контейнера (теперь stdin `-f -`); `make e2e`
  использовал общие порты dev-стека (теперь изолированные
  `E2E_*_PORT`, e2e можно гонять параллельно с dev-стеком).

### Изменения контрактов и миграции

- Admin API: `/api/v1` auth, me, employees, audit, accounts,
  connections, integrations, operations/jobs, catalog, system/backends.
  OpenAPI `backend/api/openapi.yaml`. Добавлены: `total` списка аккаунтов,
  `account_id` jobs, параметр `since`; `integration_id` в подключениях
  аккаунта.
- Core admin: `/admin/v1/*` на listener `ADMIN_HTTP_ADDRESS`,
  `api/admin-openapi.yaml`, пакет `internal/adminread`. Список аккаунтов
  отдаёт `total`, `webhook_status`, `authorization_state`,
  `recent_failed_jobs`; jobs — `account_id`, сортировку по `updated_at`
  и фильтр `type`.
- Миграции admin DB: `000001_employees`, `000002_sessions`,
  `000003_admin_audit_log`. Core: схема не менялась.

### Результаты проверок

| Команда | Репозиторий | Результат |
| --- | --- | --- |
| make check | amocrm-pro-admin | ok (2026-09-13, финальный прогон) |
| make fmt-check vet test openapi-check integration-test | amocrm-pro | ok (2026-09-13) |
| Playwright e2e | amocrm-pro-admin | 1 сценарий ok (2026-09-13) |
| Ручной сценарий 1.6 | пилотный Core + Admin API | ok (6 аккаунтов fixture, счётчики проблем 1/2/3/3/1, карточка 91000002) |
| Живая остановка `amocrm-activity-api-1` | пилотный Core | ok (`sources: unavailable`, `total: null`, баннер; после старта данные вернулись) |
| Браузерная проверка UI | Chromium (Playwright, локальный стек) | ok, ошибок консоли нет; вкладка «Виджеты», раскрытие попыток, подключения интеграции |

### Инструкция запуска и демонстрационный сценарий

- docs/runbooks/local-run.md
- docs/runbooks/demo-stage-1.md

### Происхождение данных демонстрации

- real: пилотный Core с admin listener и SQL-fixture установок;
  интеграции созданы реальным CLI-путём. OAuth с настоящим amoCRM не
  выполнялся: тестового аккаунта у команды нет.
- fixture: SQL `deploy/fixtures/core-installations.sql`
  (`settings.origin=fixture`, `audit_log.actor_type='fixture'`, домены
  `*.amocrm.test`) и adapter `kind: fixture` (`Demo`, e2e). Бейдж
  «тестовые данные» виден на всех fixture-аккаунтах.

### Повторная проверка и исправления (2026-09-13)

Закрыты все 10 пунктов
[отчёта проверки](../reviews/stage-1-2026-09-13.md): сессии, production-токен,
согласованность фактов карточки, фильтры сервисов/интеграций, keyset-история,
серверный список задач аккаунта, недоступные наблюдения и свежие доставки.
Новый маршрут `/api/v1/accounts/{account_id}/jobs`;
[ADR-0008](../adr/0008-account-stream-pagination.md).
Добавлены постоянные unit, PostgreSQL/HTTP и браузерные регрессии.
Повторный прогон: Admin `make check` — PASS, e2e — 5 PASS.
Core `make fmt-check vet test openapi-check integration-test activity-ci`
— PASS, включая 25 Activity UI-проверок. Дополнительный race-тест
пагинации с отказом/восстановлением источника — PASS.
Core-коммит `88ce79f`; изменения Admin — текущий коммит этой ветки.
Миграций нет; пилотные данные не изменялись.

### Ограничения и зависимости следующего этапа

- Авторизация `unverified` до проверки к amoCRM (этап 2).
- Нет команд enable/disable/revoke/uninstall/reconcile/retry.
- Activity SyncStatus — `unknown` до этапа 3.
- Пользователи и контакты аккаунта — нет источника.
- CI GitHub для новых веток не запускался.
- Пост-фильтры списка аккаунтов идут ограниченным сканом (≤1000
  аккаунтов, ≤10 страниц): при выходе за лимит `total` и продолжение не
  выдаются, страница помечается неполной неявно (ADR-0007). После
  появления серверных фильтров в Core механизм удаляется.
- `TRUST_PROXY_HEADERS` включается только при прокси перед API; при
  прямом доступе флаг должен быть выключен (ADR-0006).
- UI переработан без изменения данных и состояний; e2e-селекторы
  сохранены.

## Известные ограничения на входе

- Состояние авторизации до этапа 2 — `unverified`: без внешнего вызова
  валидность токена не доказана.
- Activity sync status — `unknown` до этапа 3.
- Пользователи и контакты аккаунта — нет источника.
- Реальные установки требуют OAuth с настоящим amoCRM; при их отсутствии
  демонстрация идёт на fixture с явной меткой.
