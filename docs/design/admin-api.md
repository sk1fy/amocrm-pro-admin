# Контракты: Admin API v1 и Core admin read v1

Два контракта, два репозитория. Здесь — черновик уровня «что и в какой форме»;
формальные схемы пишутся как OpenAPI 3 при реализации:
`backend/api/openapi.yaml` (Admin API) и `api/admin-openapi.yaml` (Core).

## Общие правила

- Версия в пути: `/api/v1/…`, `/admin/v1/…`. Несовместимые изменения — новая
  версия; добавление необязательных полей — совместимо.
- JSON, `snake_case`, время — RFC 3339 UTC, идентификаторы — строки.
- Ошибка — единый envelope:

  ```json
  { "error": { "code": "not_found", "message": "installation not found", "request_id": "…", "details": {} } }
  ```

  Коды: `unauthenticated`, `forbidden`, `not_found`, `invalid_argument`,
  `conflict`, `rate_limited`, `backend_unavailable`, `backend_timeout`,
  `internal`. Сообщения безопасны: без SQL, DSN, токенов, stack trace.
  Необязательное поле `retryable: bool` — как в envelope Activity bridge
  (`internal/activitybridge/http.go`, `writeError`); Core admin использует тот
  же формат, чтобы адаптер разбирал ошибки единообразно.
- Списки: `{ "items": [...], "next_cursor": "…", "total": 123|null, "sources": [...] }`.
  Курсор — непрозрачная строка (base64 от ключа сортировки). `total` — `null`,
  если не считается за разумное время. `limit` ограничен сервером (по
  умолчанию 25, максимум 100).
- Данные бекендов оборачиваются в `Observation` (ADR-0004).
- `X-Request-ID` принимается и возвращается; логируется на всех уровнях.
- Мутации (этап 2) требуют `Idempotency-Key` и возвращают `operation`.

## Admin API v1 (этот репозиторий)

Аутентификация — cookie-сессия; мутации требуют `X-Requested-With: admin-ui`.

### Auth и профиль

| Метод и путь | Право | Назначение |
| --- | --- | --- |
| `POST /api/v1/auth/login` `{email, password}` | — | Создаёт сессию, ставит cookie. 401 без деталей; 429 при превышении частоты |
| `POST /api/v1/auth/logout` | сессия | Отзывает текущую сессию |
| `GET /api/v1/me` | сессия | `{id, email, name, role, permissions[]}` |
| `GET /api/v1/me/sessions` | `sessions:self` | Список своих сессий (без токенов) |
| `DELETE /api/v1/me/sessions/{id}` | `sessions:self` | Отзыв своей сессии |

### Аккаунты и подключения

| Метод и путь | Право | Назначение |
| --- | --- | --- |
| `GET /api/v1/accounts?q=&product=&connection=&problem=&origin=&limit=&cursor=` | `accounts:read` | Поиск и список. `q` — ID, поддомен, домен или ссылка; Admin API нормализует и передаёт в Core уже id/domain/subdomain. Пост-фильтры (`product`, `connection`, `problem`, `origin`) применяются до пагинации ограниченным сканом (ADR-0007): `total` точен, пока скан завершён и все источники доступны, иначе `null` |
| `GET /api/v1/accounts/{account_id}` | `accounts:read` | Карточка: домены, агрегат, `connections[]` (каждое — Observation) |
| `GET /api/v1/accounts/{account_id}/history?cursor=` | `audit:read` | Объединённая лента: Core audit по установкам аккаунта + admin audit |
| `GET /api/v1/connections/{backend}/{connection_id}` | `connections:read` | Карточка подключения: `connection`, `authorization`, `webhook`, `grants[]`, `activity`, `recent_jobs[]`, `recent_audit[]` — каждое отдельным Observation |
| `GET /api/v1/connections/{backend}/{connection_id}/jobs?status=&type=&cursor=` | `operations:read` | Jobs подключения |
| `GET /api/v1/connections/{backend}/{connection_id}/audit?cursor=` | `audit:read` | Аудит Core по установке |

Ответ списка аккаунтов (фрагмент):

```json
{
  "items": [
    {
      "account_id": "31415926",
      "domains": ["example.amocrm.ru"],
      "state": "needs_action",
      "problems": ["reauth_required"],
      "origin": "real",
      "last_activity_at": "2026-09-12T10:00:00Z",
      "connections": [
        { "backend": "core", "connection_id": "…", "integration_code": "widget-a", "state": "reauth_required" },
        { "backend": "core", "connection_id": "…", "integration_code": "widget-b", "state": "active" }
      ]
    }
  ],
  "next_cursor": null,
  "total": 1,
  "sources": [ { "backend": "core", "status": "available", "observed_at": "2026-09-12T10:05:00Z" } ]
}
```

### Виджеты, операции, система

| Метод и путь | Право | Назначение |
| --- | --- | --- |
| `GET /api/v1/catalog` | `system:read` | Продукты, бекенды, сервисы каталога |
| `GET /api/v1/integrations?backend=` | `integrations:read` | Список интеграций всех бекендов |
| `GET /api/v1/integrations/{backend}/{integration_id}` | `integrations:read` | Карточка интеграции с грантами и счётчиками подключений |
| `GET /api/v1/operations/jobs?backend=&status=&type=&since=&cursor=` | `operations:read` | Jobs всех аккаунтов; `since` — RFC 3339, старше 7 суток обрезается до окна retention. Сортировка — по `updated_at` (новые первыми). В каждом job есть `account_id` |
| `GET /api/v1/operations/jobs/{backend}/{job_id}` | `operations:read` | Job с попытками |
| `GET /api/v1/system/backends` | `system:read` | Состояние каждого бекенда (Observation) |
| `GET /api/v1/system/audit?employee_id=&action=&cursor=` | `audit:read` | Аудит админки |
| `GET /api/v1/system/employees` | `employees:read` | Сотрудники |
| `POST /api/v1/system/employees` `{email, name, role, password}` | `employees:write` | Создание |
| `PATCH /api/v1/system/employees/{id}` `{name?, role?, status?}` | `employees:write` | Изменение; смена роли/блокировка отзывает сессии |
| `POST /api/v1/system/employees/{id}/sessions/revoke` | `employees:write` | Отзыв всех сессий сотрудника |

### Этап 2 (зарезервировано)

`POST /api/v1/connections/{backend}/{id}/commands/{command}`,
`POST /api/v1/integrations/{backend}/{id}/commands/{command}`,
`GET /api/v1/operations/admin?state=`, `GET /api/v1/operations/admin/{id}`.
Команда возвращает `202 { "operation": { "id", "state", "target", "command", "created_at" } }`.

## Core admin read v1 (`amocrm-pro`, listener `ADMIN_HTTP_ADDRESS`)

Аутентификация: `Authorization: Bearer <ADMIN_API_TOKEN>`; обязательный
`X-Admin-Actor`. Ответы содержат `observed_at` и `source: "core"`. Только чтение
на этапе 1.

| Метод и путь | Назначение | Источник |
| --- | --- | --- |
| `GET /admin/v1/backend` | `{ backend: "core", revision, contract_version: "v1", capabilities: [...], components: {...}, observed_at }` | `buildinfo`, `services.Components()`, `componentruntime` catalog |
| `GET /admin/v1/accounts?q=&integration_id=&status=&limit=&cursor=` | Аккаунты как агрегат установок; `total` — `count(DISTINCT account_id)` по фильтрам. Каждая установка несёт `webhook_status`, `authorization_state` и `recent_failed_jobs` (failed/dead за 24 ч) для счётчиков проблем Admin API | `installations` GROUP BY `account_id`, `oauth_credentials` (не ciphertext), `jobs` |
| `GET /admin/v1/accounts/{account_id}` | Аккаунт со всеми установками (без секретов) | `installations` ⋈ `integrations` ⋈ `integration_services` |
| `GET /admin/v1/installations?account_id=&domain=&integration_id=&status=&webhook_status=&limit=&cursor=` | Список установок | `installations` |
| `GET /admin/v1/installations/{id}` | Установка + `authorization` (вычисленное состояние, `expires_at`, `credential_version`, `refreshed_at`, `key_version`, `lease_active`, `unverified`) + webhook + `activity.pilot` + `webhook_destinations_count` | `installations`, `oauth_credentials` (не ciphertext), `activity_pilots`, `installation_webhook_destinations` |
| `GET /admin/v1/installations/{id}/jobs?status=&type=&limit=&cursor=` | Jobs установки без `payload`/`result`, сортировка по `updated_at` | `jobs` |
| `GET /admin/v1/installations/{id}/audit?limit=&cursor=` | Аудит по установке | `audit_log` |
| `GET /admin/v1/installations/{id}/activity/deliveries?limit=` | Квитанции и outbox команд Activity | `activitybridge.ListDeliveries` (расширить фильтром по установке) |
| `GET /admin/v1/integrations` | Интеграции с грантами и счётчиками установок | `integrations`, `integration_services`, `installations` |
| `GET /admin/v1/integrations/{id}` | Карточка интеграции | там же |
| `GET /admin/v1/jobs?status=&type=&since=&limit=&cursor=` | Jobs всех установок (окно ≤ 7 суток), в каждом `account_id` и `installation_id`; сортировка по `updated_at` | `jobs` ⋈ `installations` |
| `GET /admin/v1/jobs/{id}` | Job с попытками | `jobs`, `job_attempts` |
| `GET /admin/v1/jobs/summary` | Счётчики по статусам | `jobs` GROUP BY `status` |
| `GET /admin/v1/audit?object_type=&object_id=&action=&limit=&cursor=` | Аудит по объекту (интеграция и др.) | `audit_log` |

Фрагмент `GET /admin/v1/installations/{id}`:

```json
{
  "source": "core",
  "observed_at": "2026-09-12T10:05:00Z",
  "installation": {
    "id": "…", "integration_id": "…", "integration_code": "widget-a",
    "account_id": 31415926, "account_domain": "example.amocrm.ru",
    "status": "reauth_required", "installed_by": 123,
    "origin": "real",
    "created_at": "…", "updated_at": "…"
  },
  "authorization": {
    "state": "reauth_required", "credentials_present": true,
    "expires_at": "…", "credential_version": 3, "refreshed_at": "…",
    "key_version": 1, "lease_active": false, "unverified": true
  },
  "webhook": {
    "status": "active", "events": ["add_lead", "status_lead"],
    "checked_at": "…", "last_error": null, "confirmed_destinations": 1
  },
  "grants": [ { "service": "lead-status", "enabled": true }, { "service": "activity", "enabled": false } ],
  "activity": { "pilot": "not_configured" }
}
```

Правила реализации в Core:

- SQL выбирает колонки явно; `SELECT *` запрещён.
- Пагинация — keyset по `(updated_at, id)` или `(created_at, id)`;
  `LIMIT` ≤ 100.
- Таймаут запроса к БД — `DATABASE_TIMEOUT` из конфигурации API.
- Ошибки — JSON envelope того же формата, что и Admin API.
- Тесты: unit на маппинг состояний авторизации; integration
  (`*_integration_test.go`, пакет добавляется в список `integration-test`
  Dockerfile) на список/карточку/пагинацию/отсутствие секретных полей в JSON
  (проверка по ключам ответа). Хелпер `testkit.Reset` очищает (TRUNCATE) фиксированный
  список таблиц Core, в котором нет `activity_pilots`,
  `activity_command_receipts/outbox`, `job_queue_lanes`,
  `installation_webhook_destinations`, `integration_services`; тесты admin read,
  использующие эти таблицы, чистят их сами или расширяют список в `testkit`
  отдельным коммитом.
- Существующие Go-хранилища ориентированы на мутации и admission: списков
  установок, интеграций, jobs, аудита в них нет (`installations.Store` —
  только `FindActiveBy*`, `jobs.Store` — `GetForInstallation*`,
  `integrations.Store` — `Apply`). Запросы чтения пишутся заново в
  `internal/adminread` и не дублируют SQL мутаций.

### Уточнения после проверки этапа 1

`GET /api/v1/accounts/{account_id}/jobs` — объединённые задачи подключений
аккаунта, право `operations:read`. Параметры: `status`, `type`, `limit`,
`cursor`. Ответ — `items`, `next_cursor`, `total: null`, `sources`;
каждая задача дополнена обязательным `backend`.

История и задачи используют независимые keyset-позиции источников,
описанные в [ADR-0008](../adr/0008-account-stream-pagination.md).
Курсор привязан к аккаунту и фильтрам. Неправильный курсор — 400.

Фильтр `product` списка аккаунтов означает код сервиса каталога с выданным
грантом, например `activity`. Отдельный `integration_id` означает UUID
OAuth-интеграции; вместе с `backend` используется карточкой интеграции.
Недоступный источник делает `total` неизвестным (`null`) и без фильтров.
