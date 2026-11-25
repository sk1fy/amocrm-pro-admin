# Контракты: Admin API v1 и Core admin read v1

Два контракта, два репозитория. Здесь — черновик уровня «что и в какой форме»;
формальные схемы — OpenAPI 3:
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
- Мутации требуют `Idempotency-Key` и возвращают `operation`.

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
| `GET /api/v1/accounts/{account_id}/subscription` | `accounts:read` | Блок подписки: `{items: Observation<Subscription>[], sources[]}`; `Subscription{plan,state,expires_at,capabilities}`; опрашиваются только бекенды с capability `subscriptions`; пустой `items` — «данные подписки недоступны» (`unknown`), не «нет подписки» и не ошибка ([ADR-0012](../adr/0012-subscriptions-source.md)) |
| `GET /api/v1/accounts/{account_id}/crm-users` | `accounts:read` | Вкладка «Пользователи»: `{items: Observation<CRMUsers>[], sources[]}`; `CRMUsers{state, raw?, connection, fresh_until, retry_after_seconds, users, total}`, пользователь — `{id, name, is_active, is_admin}`. Опрашиваются только бекенды с capability `crm-users`, таймаут — `crm_timeout`. `users`/`total` равны `null`, кроме `state=ok`; `[]` — аккаунт без пользователей. `Cache-Control: no-store`, без кэша и polling ([ADR-0020](../adr/0020-account-crm-users.md)) |
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
| `GET /api/v1/system/backends` | `system:read` | Реестр `{items: BackendRegistryEntry[], observability}`. Entry: `backend`, `kind`, `display_name`, `products`, `status` (`available`/`unavailable`/`unknown`), `contract_version`, `revision`, `adapter_capabilities[]`, `backend_capabilities[]`, `components`, `observed_at` (последний успешный ответ, может быть `null`), `checked_at`, `error{code,message}`; проба кешируется 10 с |
| `GET /api/v1/system/audit?employee_id=&action=&cursor=` | `audit:read` | Аудит админки |
| `GET /api/v1/system/employees` | `employees:read` | Сотрудники |
| `POST /api/v1/system/employees` `{email, name, role, password}` | `employees:write` | Создание |
| `PATCH /api/v1/system/employees/{id}` `{name?, role?, status?}` | `employees:write` | Изменение; смена роли/блокировка отзывает сессии |
| `POST /api/v1/system/employees/{id}/sessions/revoke` | `employees:write` | Отзыв всех сессий сотрудника |

### Наблюдаемость

`GET /metrics` на management listener (`/live`, `/ready`; только
loopback/внутренняя сеть, без аутентификации). Семейства:
`admin_http_requests_total{route,method,status}`,
`admin_http_request_duration_seconds{route,method}`,
`admin_backend_probes_total{backend,outcome}`, `admin_backend_up{backend}`,
`admin_backend_last_response_timestamp_seconds{backend}`. В labels только
конечные значения: `route` — шаблон chi, `method` — HTTP-метод,
`status` — числовой код, `backend` — код из `deploy/backends.yaml`,
`outcome` — закрытый набор (`available`, `backend_unavailable`,
`backend_timeout`, `capability_unavailable`, `unknown`). ID аккаунтов,
установок, сотрудников, job и сессий, email, домены и request id в
labels запрещены — [ADR-0013](../adr/0013-admin-metrics.md).

## Core admin read v1 (`amocrm-pro`, listener `ADMIN_HTTP_ADDRESS`)

Аутентификация: `Authorization: Bearer <ADMIN_API_TOKEN>`; обязательный
`X-Admin-Actor`. Ответы содержат `observed_at` и `source: "core"`.

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

### Пользователи amoCRM (listener worker Core)

`GET /admin/v1/accounts/{account_id}/crm-users` обслуживает не admin
listener `api`, а listener worker `ADMIN_CRM_HTTP_ADDRESS`
(`core-admin-crm:8085` в сети `amocrm-admin-link`): в amoCRM ходит
только worker (ADR-0042 в `amocrm-pro`). Токен и `X-Admin-Actor` те же.
Ответ `200` всегда содержит `state`, `connection` (установка, через
которую читали), `fresh_until`, `retry_after_seconds`, `items` и `total`.
Список есть только при `state=ok`. Снимок живёт в памяти worker 5 минут,
не больше 1000 пользователей. Аккаунт без установок — `404`. В
`backends.yaml` адрес задаётся `crm_base_url`, без него Core-адаптер
возможность `crm-users` не объявляет.

## Команды

Мутации требуют сессию, Origin, X-Requested-With и Idempotency-Key.
Ответ: `202 {operation:{id,employee_id,backend,target_type,target_id,command,
state,outcome,result,error?,created_at,updated_at,finished_at,observed_at}}`.
Тело команды и ключ идемпотентности в ответ не попадают.

- `POST /connections/{backend}/{connection_id}/commands/{command}`:
  enable, disable, revoke, uninstall, reconcile, check, pilot-enable,
  pilot-disable. target_type в JSON/фильтрах — `installation`.
- `POST /integrations/{backend}/commands/create`: code, client_id,
  client_secret, redirect_uri, webhook_events, services. target_id=`new`.
- `POST /integrations/{backend}/{integration_id}/commands/{command}`:
  update, rotate-secret, enable, disable, set-service.
- `POST /operations/jobs/{backend}/{job_id}/retry` (target_type=job).
- `POST /connections/{backend}/{connection_id}/deliveries/{delivery_id}/retry`
  (target_type=delivery). Admin сам устанавливает payload.installation_id.
- `GET /operations/admin/{id}`: persisted operation envelope, polling Core
  только для неподтверждённых результатов.
- `GET /operations/admin`: список с backend, target_type, target_id,
  command, state, request_key, limit, cursor. request_key нужен для поиска
  после потери ответа POST. Порядок created_at DESC/id DESC, total=null.

Все пути выше имеют префикс `/api/v1`. Детали —
[ADR-0009](../adr/0009-durable-admin-operations.md) и OpenAPI.

Карточка подключения дополнена `authorization_check` Observation с
classification, observed_at, retry_after (если задан). Jobs/deliveries
дополнены retry_allowed и retry_reason. HTTP 202 может содержать уже
терминальное состояние; success HTTP не означает успешность команды.

`state=succeeded`, `outcome=queued` подтверждает только постановку задачи
для reconcile/retry. Дальнейший результат читается отдельно по `job_id`
через существующий маршрут просмотра задачи.

## Activity, статистика и представления

Чтения (сессия + RBAC). Все данные бекенда — Observation.

| Метод и путь | Право |
| --- | --- |
| `GET /api/v1/connections/{backend}/{id}/activity/settings` | `connections:read` |
| `GET /api/v1/connections/{backend}/{id}/activity/status` | `connections:read` |
| `GET /api/v1/connections/{backend}/{id}/activity/panels` | `connections:read` |
| `GET /api/v1/connections/{backend}/{id}/activity/panels/{panel_id}` | `connections:read` |
| `GET /api/v1/connections/{backend}/{id}/activity/employees` | `connections:read` |
| `GET /api/v1/connections/{backend}/{id}/lead-status/rules` | `connections:read` |
| `GET /api/v1/connections/{backend}/{id}/lead-status/runs` | `operations:read` |
| `GET /api/v1/stats?period=24h\|7d\|30d` | `stats:read` (по умолчанию `7d`) |
| `GET /api/v1/stats/accounts?metric=&period=&product=&cursor=` | `stats:read` (по умолчанию `7d`) |
| `GET /api/v1/views?section=` | `accounts:read` |
| `POST /api/v1/views` | `views:write` (личные; общие — только admin) |
| `PATCH /api/v1/views/{id}` | `views:write` (владелец; общие — admin) |
| `DELETE /api/v1/views/{id}` | `views:write` (владелец; общие — admin) |

UI всегда передаёт `period` явно, окно по умолчанию — `24h`; `7d` —
умолчание Admin API при отсутствии параметра, как в Core.

Мутации идут существующим
`POST /connections/{backend}/{id}/commands/{command}`:
`activity-configure`, `activity-sync`, `activity-panel-create`,
`activity-panel-patch`, `activity-panel-rotate`,
`lead-status-configure`. HTTP 409 Core → операция `failed`/`conflict` с
текущими значениями в `result`. `GET /system/backends` добавляет
`observability.grafana_base_url` / `loki_base_url` без секретов.

### Отказы входа и изменение доступа

Вход: неверные credentials/отключённый сотрудник — одинаковый `401`;
ошибка БД или сохранения сессии — `500` (`internal`) с `request_id`;
лимит попыток или ёмкости limiter — `429`.

Создание/изменение сотрудника, требуемый отзыв сессий и аудит выполняются
одной транзакцией Admin DB. PATCH блокирует строку до чтения старых прав;
непереданные поля сохраняют актуальные значения. Отзыв своих/чужих
сессий и logout также фиксируются вместе с аудитом.

## Проверка актуальности

`GET /api/v1/accounts` принимает независимый параметр
`verification=ok|stale|unknown|failed`. Параметр не меняет фильтр `connection`.
Установки в списке и карточке получают optional `authorization_check`:
classification, observed_at, freshness, fresh_for_seconds, безопасная ошибка.
`GET /api/v1/stats` добавляет optional `verification` со счётчиками
unverified, temporary_errors, verified. Отсутствие поля означает отсутствие
факта, не нулевое значение. По verification total может быть null;
пустая страница с next_cursor требует продолжения.

Источник, который не отдаёт `authorization_check` (Core без этого поля),
не может ответить на `ok|stale|failed`. Такой источник попадает
в `sources` со статусом `unavailable` и ошибкой `capability_unavailable`
после первой прочитанной страницы, а не даёт пустой список. Фильтр
`unknown` для него работает как раньше.

Курсор списков из нескольких источников (аккаунты без фильтров,
`/integrations`, `/operations/jobs`) хранит позицию каждого источника.
Исчерпанный источник отмечается и больше не читается; источник, который
не ответил, сохраняет прежнюю позицию до восстановления. `next_cursor`
равен null, когда исчерпаны все источники. В курсоре прежнего формата
отсутствующий источник считается исчерпанным.

## Распределение (РС-09)

GET `connections/{backend}/{connection_id}/distribution` возвращает
Observation типизированной сводки. GET `.../distribution/trace` принимает
UUID `reference`, keyset `cursor`, `limit` 25/100; это Observation
`{items,next_cursor,total:null}`. Полные схемы в `backend/api/openapi.yaml`.
Оба пути под `/api/v1`, с сессией и правом `connections:read`.
Некорректный UUID/limit — 400; чужая установка — 404.
Нет capability — unknown без data; отказ/timeout — unavailable без data.
404 нового Core с capability сохраняет 404; старый Core без capability
даёт unknown: возможность либо установка недоступна.

Команды используют существующий POST `.../commands/{command}`.
`distribution-pause/resume`: `{expected_paused:boolean}`.
`distribution-delivery-retry`: `{kind:events|results,message_id:UUID,
expected_attempts:integer}`. `distribution-reconcile`:
`{operation_id:UUID,expected_result_version:integer}`.
Сессия/Origin/X-Requested-With/Idempotency-Key обязательны.
202 возвращает durable admin operation, не подтверждение CRM эффекта.

Результат `distribution-reconcile` сохраняет `assignment_state`,
`external_effect_state`, `evidence` независимо от состояния admin-команды.
Эти поля принимают только известные коды Core; новый/небезопасный код
нормализуется в unknown. Старые квитанции без полей остаются совместимыми.

Trace `id` — идентификатор строки, может быть составным. `message_id` —
UUID замороженного конверта; повтор разрешён только при его наличии.
`operation_id` и `result_version` связывают результат с назначением.

## Расширение диагностики Digital Pipeline (06.10.2026)

Summary распределения содержит необязательный nullable digital_pipeline
с inbox/triggers типа DistributionBacklog. Null означает отсутствие
фактов у источника. Права и URL маршрута не изменились; live ключи
и тела событий не возвращаются. Поля описаны в backend/api/openapi.yaml.

## Вход в кабинет менеджеров

Маршруты включаются через `MANAGERS_PUBLIC_ORIGIN`. Сервер сверяет Host
с конфигурацией обоих кабинетов. Публичный прокси передаёт фактический Host.

| Метод и маршрут | Результат |
| --- | --- |
| `POST /api/v1/managers/auth/login` | Проверяет email, пароль и наличие менеджерских прав. Возвращает профиль и host-only cookie `manager_session`. |
| `GET /api/v1/managers/me` | Возвращает `id`, `email`, `name` и актуальные `grants`. |
| `POST /api/v1/managers/auth/logout` | Отзывает текущую менеджерскую сессию и очищает cookie. |

Вход и выход требуют `X-Requested-With: admin-ui` и Origin кабинета
менеджеров. При отсутствии прав на вход сервер возвращает обычный `401`.
Запросы на другой host получают `404`.

### Очередь установок

`GET /api/v1/managers/installations` требует `clients.read`. Список
показывает эпизоды установки и срок доступа к продукту на `snapshot_at`.
Поле `amo_account_id` содержит строку с десятичным числом. Счётчики
`summary` относятся ко всему снимку с выбранными фильтрами.

Курсор `next_cursor` связан с сотрудником, его правами, фильтрами,
сортировкой и размером страницы. Ответ `400` с
`details.code=invalid_cursor` требует загрузить первую страницу.
При `query_too_broad` требуется сузить фильтры. Недоступность Platform
возвращает `503`.

`PUT /api/v1/managers/installations/{id}/review` требует `clients.write`,
Origin кабинета, `X-Requested-With: admin-ui`, UUID в `Idempotency-Key`
и версию установки в `If-Match` в кавычках. Тело команды содержит
`reviewed` и необязательный `reason`. Успех возвращает эпизод и актуальный
`ETag`. Ответ `202` содержит ID исходной команды и `Location` для
проверки результата. Для безопасного повтора нужны исходные тело, версия
и ключ. Ответ `409` различает `version_conflict` и
`idempotency_conflict` через `details.code`.

### Клиенты

Префикс маршрутов `/api/v1/managers`. UUID клиента в маршруте обозначает
запись Platform. Права действуют в текущей менеджерской сессии.

| Маршрут | Право | Результат |
| --- | --- | --- |
| `GET /accounts`, `POST /accounts/search` | `clients.read` | Список, итог Platform, курсор, время снимка и `sources` |
| `GET /accounts/{id}` | `clients.read` | Карточка и `ETag` профиля |
| `GET /accounts/{id}/widgets` | `clients.read` | Собственные виджеты с версиями сроков |
| `GET /accounts/{id}/license-history` | `clients.read` | Подтверждённые наблюдения лицензии |
| `GET /accounts/{id}/crm-users` | `clients.read` | Последний полный список пользователей и его свежесть |
| `GET /accounts/{id}/portrait` | `clients.read` | Портрет и его `ETag` |
| `PATCH /accounts/{id}/profile` | `clients.write` | Сохранённый профиль и `ETag` |
| `PATCH /accounts/{id}/portrait`, `POST /accounts/{id}/portrait/audit-dates` | `clients.write` | Сохранённый портрет и `ETag` |
| `POST /accounts/{id}/refresh` | `clients.write` | `202` с ID команды и локальным адресом опроса |
| `POST /accounts/{id}/renewals` | `clients.renew` | `201` и `ETag` срока выбранного продукта |
| `GET /portrait-template`, `GET /portrait-niches` | `clients.read` | Версия шаблона и справочник ниш |
| `PUT /portrait-template` | `configuration.manage` | Сохранённый шаблон и `ETag` |
| `POST /portrait-niches`, `PATCH /portrait-niches/{id}`, `POST /portrait-niches/{id}/merge` | `configuration.manage` | Созданная, изменённая или оставшаяся после объединения ниша и `ETag` |
| `DELETE /portrait-niches/{id}` | `configuration.manage` | `204` после подтверждённого удаления |

Список и поиск поддерживают фильтры P01, включая дерево условий
`portrait_filter` в теле `POST /accounts/search`. Поиск требует Origin
кабинета и `X-Requested-With: admin-ui` и сохраняет семантику чтения.

`data_group`, `tariff` и `renewal_channel` можно комбинировать с
`classification` и остальными параметрами на обоих маршрутах списка.
`summary.total` учитывает фильтры, `summary.overview` описывает полную
доступную выборку. Оба значения сохраняются в курсорном снимке.
Для ручной отметки «Клиент партнёра» в PATCH профиля требуется
`partner_name`. Изменение использует прежние версию, права и аудит.

Мутации дополнительно требуют UUID `Idempotency-Key`. Для обновления
ресурса нужен сильный `If-Match` соответствующей версии. Для продления
это `access.entitlement_version` выбранного виджета. Создание ниши и
обновление наблюдений обходятся без версии. Наблюдения `unknown`,
`stale` и `unsupported` остаются данными ответа. Общая история клиента
подключается в P09 и A06.

При потере ответа команда возвращает `202` со `state=unknown_outcome`,
`Location` и, при ограничении частоты, `Retry-After`. Подтверждённое
фоновое обновление возвращает `202` со `state=platform_operation` и
таким же локальным `Location`. Повтор использует исходные тело, ключ
и версию. Ответ `409` различает конфликты ключа, версии и состояния по
`details.code`. Например, `state_conflict` сообщает, что дата аудита уже
есть или ниша используется. `details.current_version` содержит целое
значение при `version_conflict` и при наличии версии у `state_conflict`.

### Состояние менеджерской команды

`GET /api/v1/managers/operations/{id}` требует активную менеджерскую
сессию, исходного владельца, `clients.read` и актуальное право на вид
команды. Для чтения ранее запущенного повтора сделки по установке
достаточно `clients.read`. Platform проверяет право на ресурс.
Идентификатор совпадает с `command_id`.

Ответ `200` содержит `id` и `state`: `unknown_outcome`, `completed`,
`rejected` или `platform_operation`. В последнем случае блок
`operation` содержит состояние Platform, тип, ID цели и даты. Поля
ошибок Platform не передаются в браузер. Клиент может учитывать
`retry_after_seconds` или заголовок `Retry-After` у ответов `429` и
`503`. Код `503` означает, что Admin сейчас не может прочитать состояние.

### Лента и история аккаунта

В ответах `GET /api/v1/managers/feed` и
`GET /api/v1/managers/accounts/{id}/history` у события могут быть
`account_subdomain` и `product_display_name`. Поля доступны при
`clients.read` и наличии разрешённой записи у Platform. Они описывают
текущие названия. Состав и порядок курсорного снимка сохраняются.

### Сотрудники кабинета менеджеров

Все маршруты `/api/v1/managers/staff` обслуживает Admin без Platform.
Чтение списка, карточки и `/grants` требует `staff.manage`.
Создание через POST, `/invitation/reissue` и `/sessions/revoke`
дополнительно требуют `identity.manage`. PATCH заменяет набор grants.
Пустой набор отзывает менеджерский доступ. Альтернативное тело PATCH
содержит только `access_enabled`. При выключении права сохраняются
для последующего восстановления, сеансы кабинета завершаются.
Собственное добавление прав и выключение своего доступа через
переключатель запрещены. PATCH и перевыпуск требуют сильный `If-Match` из
`ETag` карточки. Мутации требуют CSRF и UUID `Idempotency-Key`.

Staff содержит `id`, `email`, `name`, `status`, `grants`, `version`,
`changed_at`, nullable UUID `changed_by`. Список поддерживает поиск
`search`, `limit` 25/100 и подписанный `cursor`. Ответ содержит `items`
и nullable `next_cursor`. Канонический каталог grants возвращает `items`.
Команда возвращает `staff` и `link_unavailable`. Создание возвращает 201,
остальные команды 200. Первая выдача приглашения дополнительно содержит
`invitation_url` с фрагментом `#invitation=`. Ответы имеют `no-store`.
Квитанция не хранит ссылку; точный повтор сообщает `link_unavailable`.

`POST /api/v1/managers/auth/invitations/accept` принимает `token`,
`password`, UUID `Idempotency-Key`, Origin и `X-Requested-With`.
Сессия не требуется, действует ограничитель попыток входа по IP.
Успех возвращает `accepted=true`. Повтор с теми же токеном, ключом
и паролем безопасен после потери ответа. Другая команда отвергается.
Принятую identity нельзя сбросить перевыпуском приглашения.

`GET /api/v1/managers/security/audit` требует `security.audit.read`.
Он возвращает безопасные поля события без metadata, IP и секретов.
Разрешены фиксированные действия manager и события входа/выхода
с явным `metadata.audience=managers`. Технический аудит исключён.
Пагинация использует подписанный cursor и лимит 25/100.

Коды конфликта в `details.code` различают `version_conflict`,
`idempotency_conflict`, `email_exists`, `last_administrator`,
`invitation_unavailable`. Собственная эскалация возвращает 403
с `self_escalation`. Отключение последнего менеджерского администратора
в техническом API также возвращает 409 с `last_administrator`.

## Настройка сделок менеджеров

Префикс `/api/v1/managers`. Источник — принятый manager API Platform.

| Метод | Путь | Grant |
| --- | --- | --- |
| GET | `/company-workflow-metadata` | catalog.manage |
| GET | `/installation-deal-settings` | catalog.manage |
| PUT | `/installation-deal-settings` | catalog.manage |

Источник, nullable снимки и строковые CRM ID сохраняют смысл владельца.
Метаданные дополняются `observation` и `sources` BFF.
GET workflow не создаёт строку: без настройки версия 1, конфигурация null.
PUT использует собственный If-Match workflow, Idempotency-Key и CSRF.
Первая запись возвращает версию 2 и ревизию настройки 1. Версия
относится к активной привязке компании. Тело содержит `source_account_id`,
`binding_revision`, `metadata_generation_id`, `pipeline_id`,
`initial_stage_id`. Источник — утверждение текущей привязки.

Неизвестный исход возвращает существующую операцию 202; receipt и точный
повтор используют сохранённый intent. Временный 503 не меняет ключ.
409 с `company_source_conflict` или `company_metadata_conflict` требует
явного применения сохранённого черновика; 422 `company_stage_mismatch`
объясняет отсутствие членства этапа. Точный replay успеха проверяет текущие
права и возвращает исходный результат владельца.


В ответе списка установок `queue_counts` относится к общим фильтрам без
`review`. `summary` относится к отобранной очереди и определяет пагинацию.
При использовании курсора обе сводки относятся к исходному снимку.


`POST /api/v1/managers/installations/{id}/crm-deal/retry` ставит повтор
по версии сделки. Требуются `clients.write`, `Idempotency-Key` и
`If-Match`. Ответ `202` с Location ведёт к операции менеджера.

## Сводка каталога виджетов

`GET /api/v1/managers/products?overview=true` требует
`clients.read` и `stats.read`. Ответ добавляет `overview` со
сводкой по каталогу, статистикой по UUID продуктов текущей
страницы и первыми 100 установками в очереди «Нет связи».

`sort` принимает `installations`, `name` или `code`.
Расширенный список упорядочен по числу установок по умолчанию.
`attention=true` фильтрует каталог до пагинации. Сводка и
очередь остаются общими для всех страниц.

Для настройки сделок по установкам company-workflow-metadata возвращает employees из снимка корпоративной amoCRM. У GET и PUT installation-deal-settings поле owners содержит ID сотрудников по ключам direct, partner, own и unclassified. При передаче owners команда заменяет набор целиком, пустой объект сбрасывает назначения. Пропуск поля сохраняет набор.

Список установок принимает необязательный фильтр state со значениями current или removed. Экран очереди передаёт current, поэтому счётчики обеих вкладок и страницы используют один набор эпизодов.

POST /api/v1/managers/accounts/{id}/subscription принимает действия
grant, renew, seats и revoke. Требует clients.renew, версию профиля и
ключ идемпотентности. Результат — актуальная карточка с новой версией.
