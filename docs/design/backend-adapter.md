# Контракт адаптера бекенда (v1)

Адаптер — единственный способ Admin API общаться с бекендом. Core —
первый адаптер (`adapter/core`), fixture — тестовый
(`adapter/fixture`). Контракт заморожен в v1; политика
совместимости, возможности и версионирование —
[ADR-0011](../adr/0011-adapter-contract-v1.md).

## Принципы

- Адаптер **не знает** о сотрудниках, ролях и HTTP админки. Получает
  `ctx`, фильтры и `Actor` (строка для аудита).
- Адаптер **возвращает наблюдения**: результат снабжён `observed_at`;
  ошибки типизированы (`ErrUnavailable`, `ErrTimeout`, `ErrNotFound`,
  `ErrUnsupported`, `ErrInvalidArgument`, `ErrConflict`, `ErrRejected`).
- Адаптер **объявляет возможности** (`Capabilities`). Вызов
  необъявленной возможности возвращает `ErrUnsupported`; интерфейс
  показывает `unknown`, а не ошибку.
- Адаптер **переводит состояния** в канонический словарь
  ([states.md](states.md)) и сохраняет оригинал в `Raw`.
- Локальные идентификаторы бекенда непрозрачны для Admin API и
  передаются в URL как `{backend}/{id}`. Связь с аккаунтом — только
  через `AccountID` (amoCRM account id) и `ProductCode` (код продукта
  каталога).

## Возможности

Коды `Capabilities.Names()` в фиксированном порядке: `accounts`,
`connections`, `integrations`, `jobs`, `audit`, `diagnostics`,
`commands`, `settings`, `stats`, `activity-deliveries`,
`subscriptions`. Возможность — единственный источник истины о
доступности функции. Адаптер может объявить возможность, но не
реализовать интерфейс — тогда функция недоступна: опциональные
интерфейсы проверяются вместе с возможностью. Read-only бекенд без
них остаётся допустимым.

`diagnostics` — внешняя проверка подключения (`authorization_check`)
доступна через `CommandBackend`; capability объявлена, вызов идёт
командой `check`. Обязательные read-capabilities (`accounts`,
`connections`, `integrations`, `jobs`, `audit`,
`activity-deliveries`) обеспечиваются реализациями адаптеров и
фильтром реестра (`accounts.Capable`), а опциональные интерфейсы —
проверками `AsSettings`/`AsStats`/`AsSubscription`.

## Интерфейс (Go)

Реализация: `backend/internal/adapter`. Адаптер получает `Actor`
(строка `employee:<uuid>` для `X-Admin-Actor`) и не знает о сессиях
админки.

```go
package adapter

type Descriptor struct {
    Code            string        // "core"
    Kind            string        // "core-http", "fixture"
    ContractVersion string        // "v1"
    Timeout         time.Duration
}

type Capabilities struct {
    Accounts, Connections, Integrations, Jobs, Audit bool
    Diagnostics, Commands, Settings, Stats bool
    ActivityDeliveries, Subscriptions bool
}

func (c Capabilities) Names() []string // коды включённых возможностей

type Observation[T any] struct {
    Source     string     `json:"source"`
    ObservedAt time.Time  `json:"observed_at"`
    Freshness  string     `json:"freshness"` // fresh|stale|unavailable|unknown
    Error      *ObsError  `json:"error,omitempty"`
    Data       *T         `json:"data,omitempty"` // omit when unavailable
    Raw        string     `json:"raw,omitempty"`
}

type SourceStatus struct {
    Backend    string     `json:"backend"`
    Status     string     `json:"status"`
    ObservedAt *time.Time `json:"observed_at,omitempty"`
    Error      *ObsError  `json:"error,omitempty"`
}

type Backend interface {
    Descriptor() Descriptor
    Capabilities() Capabilities
    Health(ctx context.Context, actor Actor) (Observation[Health], error)

    ListAccounts(ctx context.Context, actor Actor, f AccountFilter) (Observation[Page[Account]], error)
    GetAccount(ctx context.Context, actor Actor, accountID int64) (Observation[Account], error)

    ListConnections(ctx context.Context, actor Actor, f ConnectionFilter) (Observation[Page[ConnectionSummary]], error)
    GetConnection(ctx context.Context, actor Actor, id string) (Observation[ConnectionDetail], error)
    ListConnectionJobs(ctx context.Context, actor Actor, id string, f JobFilter) (Observation[Page[Job]], error)
    ListConnectionAudit(ctx context.Context, actor Actor, id string, f PageFilter) (Observation[Page[AuditEntry]], error)
    ListConnectionDeliveries(ctx context.Context, actor Actor, id string, f PageFilter) (Observation[[]Delivery], error)

    ListIntegrations(ctx context.Context, actor Actor, f PageFilter) (Observation[Page[Integration]], error)
    GetIntegration(ctx context.Context, actor Actor, id string) (Observation[Integration], error)

    ListJobs(ctx context.Context, actor Actor, f JobFilter) (Observation[Page[Job]], error)
    GetJob(ctx context.Context, actor Actor, id string) (Observation[JobDetail], error)
    JobsSummary(ctx context.Context, actor Actor) (Observation[JobsSummary], error)
}
```

### Опциональные интерфейсы

```go
type CommandBackend interface {
    ExecuteCommand(context.Context, Actor, string, CommandRequest) (CommandResult, error)
    GetCommand(context.Context, Actor, string) (CommandResult, error)
}

type SettingsBackend interface {
    GetActivitySettings(context.Context, Actor, string) (Observation[ActivitySettings], error)
    GetActivitySyncStatus(context.Context, Actor, string) (Observation[ActivitySyncStatus], error)
    ListActivityPanels(context.Context, Actor, string) (Observation[[]ActivityPanel], error)
    GetActivityPanel(context.Context, Actor, string, string) (Observation[ActivityPanel], error)
    ListActivityEmployees(context.Context, Actor, string) (Observation[[]ActivityEmployee], error)
    ListLeadStatusRules(context.Context, Actor, string) (Observation[[]LeadStatusRule], error)
    ListLeadStatusRuns(context.Context, Actor, string, PageFilter) (Observation[Page[LeadStatusRun]], error)
}

type StatsBackend interface {
    GetStats(context.Context, Actor, string) (Observation[StatsSnapshot], error)
    ListStatsAccounts(context.Context, Actor, StatsAccountFilter) (Observation[Page[StatsAccount]], error)
}

type SubscriptionBackend interface {
    GetSubscription(ctx context.Context, actor Actor, accountID int64) (Observation[Subscription], error)
}
```

Проверка — возможность **и** интерфейс вместе:
`AsSettings`/`AsStats`/`AsSubscription` возвращают интерфейс и `bool`;
`bool` — `false`, если возможность не объявлена или интерфейс не
реализован; для команд — утверждение типа вместе с
`Capabilities().Commands`. Вызов метода без такой проверки — ошибка
адаптера.

### Типизированные ошибки

`ErrUnavailable`, `ErrTimeout`, `ErrNotFound`, `ErrUnsupported`,
`ErrInvalidArgument`, `ErrConflict`, `ErrRejected`. HTTP-адаптер Core
переводит 401/403/5xx в `ErrUnavailable` (для команд 401/403 —
`ErrRejected`), таймаут в `ErrTimeout`, 404 в `ErrNotFound`, 400 в
`ErrInvalidArgument`, 409 в `ConflictError` с текущим значением.
Сообщение безопасно: без DSN, SQL, токенов и URL с параметрами.
Неизвестное бекендное состояние → канон `unknown` и `Raw` с оригиналом;
значение `active` не подставляется.

### Типы данных

`State{Canonical, Raw}`, `Page[T]{Items, NextCursor, Total}`;
`Account`, `ConnectionSummary`, `ConnectionDetail`, `Authorization`,
`Webhook`, `Grant`, `ActivityFacts`, `Job`, `JobAttempt`, `JobDetail`,
`JobsSummary`, `AuditEntry`, `Integration`, `Delivery`, `Health`,
`Subscription`, `ActivitySettings`, `ActivitySyncStatus`,
`ActivityPanel`, `ActivityEmployee`, `LeadStatusRule`, `LeadStatusRun`,
`StatsSnapshot`, `StatsAccount`. Все содержат только канонические
состояния и безопасные факты; никаких секретов, ciphertext, payload.

## Реестр и состояние

`catalog.Registry` загружается из `deploy/backends.yaml`.
`Registry.Probe(ctx, actor)` возвращает `[]ProbeResult` и читает
`Health` каждого бекенда с индивидуальным таймаутом
(`Descriptor().Timeout`, затем таймаут конфигурации, запасной 5s) и
кешем TTL (по умолчанию 10s): чаще TTL health не перечитывается.

- `status` — каноническая доступность источника: `available`,
  `unavailable`, `unknown` до первой проверки. `degraded` остаётся в
  словаре [states.md](states.md), но Probe его сейчас не выставляет.
- Время последнего успешного ответа `observed_at` и последняя ошибка
  сохраняются между проверками: сбой не стирает время последнего
  подтверждённого ответа, а успех очищает последнюю ошибку. `checked_at`
  — время последней проверки.
- `adapter_capabilities` — `Capabilities.Names()`; `revision`,
  `backend_capabilities` и `components` приходят из последнего успешного
  `Health`; `contract_version` — из `Health`, иначе из дескриптора.
- Секретов нет: ответ содержит только `backend`, `kind`, `display_name`,
  `products`, `status`, `contract_version`, `revision`,
  `adapter_capabilities`, `backend_capabilities`, `components`,
  `observed_at`, `checked_at`, `error`.
- `GET /api/v1/system/backends` отдаёт этот список. Экран Система
  показывает по строке на бекенд: имя и код, тип адаптера, состояние,
  контракт, ревизию, возможности адаптера, время последнего ответа и
  проверки, безопасный текст ошибки, а также ссылки Grafana/Loki из env
  (`observability`).
- Результаты проб питают метрики Prometheus
  ([ADR-0013](../adr/0013-admin-metrics.md)).

## Агрегация и частичная доступность

`adapter.Gather` опрашивает адаптеры параллельно (`errgroup`) с
таймаутом каждого (`Descriptor().Timeout`, запасной 5s), собирает
`sources[]` и прикладывает наблюдения. `accounts.Service` объединяет
аккаунты по `AccountID`. Отказ одного адаптера →
`sources[i].status = unavailable`, остальные данные возвращаются.
`ErrNotFound` одного бекенда — не ошибка: источник считается доступным,
а факт просто отсутствует.

`ConnectionSummary` несёт `recent_failed_jobs` (failed/dead за 24 ч), а
`Job` — `account_id`: эти факты заполняются адаптером, если источник их
отдаёт. Admin API не досчитывает их сам и не скрывает отсутствие:
недоступные значения остаются нулевыми и такими же показываются.

Пагинация при нескольких бекендах — по каждому бекенду отдельно с
составным курсором `{backend: cursor}`. Пост-фильтры списка аккаунтов
применяются ограниченным сканом до пагинации
([ADR-0007](../adr/0007-account-filter-scans.md)).

## Команды (v1)

Опциональный `CommandBackend` дополняет read-only `Backend`:
`ExecuteCommand(ctx, actor, key, CommandRequest)` и
`GetCommand(ctx, actor, id)`. `CommandRequest` содержит target_type,
target_id, command, payload. `CommandResult` — id, state, outcome,
result, error, observed_at, job_id. Core HTTP использует
`POST /admin/v1/commands` и `GET /admin/v1/commands/{id}`; UUID операции
Admin передаётся как `Idempotency-Key` и он же Core receipt ID. Мутации
не следуют HTTP-redirect, включая перенаправление тела 307/308. 409
разбирает текущие settings/rule в `ConflictError.Current`. Транспортная
ошибка после dispatch означает unknown_outcome, а не разрешение
повторить отправку; повторяемость ограничена списком безопасных команд
([ADR-0009](../adr/0009-durable-admin-operations.md)).

Admin сохраняет только известные безопасные поля `result`; неизвестные
вложенные структуры отбрасываются. Fixture-адаптер выполняет отмеченные
тестовые команды под mutex, читает из копий read snapshot, не выполняет
OAuth и не хранит переданные секреты.

## Настройки и статистика (v1)

Опциональные `SettingsBackend` и `StatsBackend`; `AsSettings`/`AsStats`
проверяют возможность (`settings`, `stats`) вместе с интерфейсом.
`core-http` и fixture их объявляют; бекенд без них остаётся допустимым.

- Settings: Activity settings/status/panels/employees, lead-status
  rules/runs. Неизвестный sync state → `unknown` + `Raw`.
- Stats: `GetStats(period)`, `ListStatsAccounts(metric, period, …)`;
  периоды `24h`, `7d`, `30d` (`ValidStatsPeriod`).
- Core GET: `/admin/v1/installations/{id}/activity/*`, `/lead-status/*`,
  `/admin/v1/stats`, `/admin/v1/stats/accounts`.
- Fixture: idle+lag 12 на установке с грантом Activity; unknown sync на
  другой; CAS conflict; sync kind=sync pending → succeeded на GetCommand.
  Решения — [ADR-0010](../adr/0010-stage-3-activity-stats.md).

## Подписки (v1)

Подписка — коммерческий факт аккаунта, отдельный от технического гранта
сервиса (`Grant`). Опциональный `SubscriptionBackend` с
`GetSubscription(ctx, actor, accountID)` и возможностью
`subscriptions`; `Subscription{Plan, State, ExpiresAt, Capabilities}`,
канонические состояния `active`/`trial`/`expired`/`cancelled`,
неизвестное значение → `unknown` + `Raw`.
`GET /api/v1/accounts/{account_id}/subscription` опрашивает только
способные бекенды и возвращает `{items, sources[]}`; пустой `items` —
«данные подписки недоступны», а не «нет подписки». Решение и
отклонённые варианты — [ADR-0012](../adr/0012-subscriptions-source.md).

## Уточнения чтения

- `ConnectionSummary` сохраняет полные `AuthorizationDetails` и
  `WebhookDetails`, если источник их передал; агрегат не заменяет
  неизвестные факты `false`/нулём. Из Core также переносятся
  `recent_failed_jobs` в списке и карточке и `grants` в списке
  аккаунтов.
- `Job.Cursor` и `AuditEntry.Cursor` — внутренние позиции сразу после
  соответствующей строки; DTO не сериализуют их
  ([ADR-0008](../adr/0008-account-stream-pagination.md)).

## Конфигурация

```yaml
# deploy/backends.yaml
version: 1
backends:
  - code: core
    kind: core-http
    display_name: "Core (amocrm-pro)"
    base_url: http://host.docker.internal:18083
    token_env: CORE_ADMIN_API_TOKEN
    timeout: 5s
    health_path: /admin/v1/backend
    products:
      - code: lead-status
        display_name: "Статусы сделок"
      - code: activity
        display_name: "Активность сотрудников"
  - code: fixture
    kind: fixture
    profile: module
    display_name: "Fixture module (тестовые данные)"
    timeout: 2s
    products:
      - code: fixture-module
        display_name: "Демонстрационный модуль"
```

Секреты в файл не попадают: `token_env` называет переменную окружения, из
которой берётся токен; отсутствующая переменная — ошибка старта, а не
значение по умолчанию. `base_url` и `token_env` обязательны для
`core-http`; `timeout` (по умолчанию 5s) — таймаут адаптера;
`health_path` по умолчанию `/admin/v1/backend`. `products` задают коды
каталога — ключ связи бекенда со сценариями.

`kind: fixture` — тестовый адаптер (`profile: demo|module`, при
опущенном профиле `demo`): `demo` объявляет все возможности, `module` —
только чтение. Fixture подставляет синтетические данные с меткой
`origin=fixture` и в проде не используется.

## Verification summary

`ConnectionSummary.AuthorizationCheck` optional. Core adapter передаёт
нормализованную classification/freshness, timestamp и срок актуальности.
Неизвестная classification превращается в unknown + raw; upstream error
body не передаётся. `AccountFilter.Verification` передаётся в Core query;
старые источники совместимы через bounded post-filter. `Account.Cursor`
содержит native continuation, его не возвращают отдельным полем клиенту.
Правила: [ADR-0017](../adr/0017-connection-state-freshness.md).
