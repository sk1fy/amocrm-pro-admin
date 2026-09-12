# Этап 1. Основа приложения и просмотр аккаунтов

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

Заполняется агентом перед началом после сверки с `amocrm-pro/main`:

- [ ] Коммит `amocrm-pro`, относительно которого делается работа: `…`
- [ ] Расхождения с «Фактами о бекенде» из [README](README.md): …
- [ ] Зафиксированные версии: Go `…`, PostgreSQL `17`, React `…`, Vite `…`,
      TanStack Router `…`, TanStack Query `…`, TypeScript `…`, Vitest `…`,
      Playwright `…` (получены `npm view`, записаны в `package.json`).

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

- [ ] Аккаунт находится по ID, поддомену, домену и полной ссылке.
- [ ] Несколько виджетов одного аккаунта показаны отдельно; состояние одного
      не подменяет состояние другого (тест агрегации + скриншот).
- [ ] `viewer` не может выполнить изменение прямым вызовом API (403 на всех
      `*:write`), `operator` — на `employees:*`.
- [ ] Недоступность Core admin listener (остановить `api` пилотного стека)
      отображается баннером и `unavailable` в карточках; вход, навигация,
      раздел Сотрудники работают.
- [ ] Свежесть (`observed_at`) видна у каждого блока данных бекенда.
- [ ] Пагинация: курсор стабилен при добавлении записей, лимит > 100
      обрезается.
- [ ] Ответы Core admin read и Admin API не содержат ключей с `secret`,
      `token`, `ciphertext`, `key_hash` (автотест).
- [ ] Фильтры и курсор сохраняются в URL; прямые ссылки на аккаунт и
      подключение открываются после входа.
- [ ] Метка `fixture` видна на всех тестовых данных.
- [ ] `make check` зелёный в обоих репозиториях; CI `amocrm-pro` проходит.

## Отчёт (заполняется по завершении)

По шаблону из [STYLE_GUIDE.md](../STYLE_GUIDE.md#отчёт-об-этапе): реализованные
экраны и операции; изменения контрактов и миграции; результаты проверок;
инструкция запуска и демонстрационный сценарий; ограничения и зависимости
этапа 2.

## Известные ограничения на входе

- Состояние авторизации до этапа 2 — `unverified`: без внешнего вызова
  валидность токена не доказана.
- Activity sync status — `unknown` до этапа 3.
- Пользователи и контакты аккаунта — нет источника.
- Реальные установки требуют OAuth с настоящим amoCRM; при их отсутствии
  демонстрация идёт на fixture с явной меткой.
