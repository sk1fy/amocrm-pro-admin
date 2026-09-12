# Контракт адаптера бекенда (v1, черновик)

Адаптер — единственный способ Admin API общаться с бекендом. Core — первый
адаптер (`adapter/core`), fixture — тестовый (`adapter/fixture`). Контракт
завершается и версионируется на этапе 4; здесь фиксируется основа, чтобы этап 1
не создал несовместимую форму.

## Принципы

- Адаптер **не знает** о сотрудниках, ролях и HTTP админки. Получает `ctx`,
  фильтры и `Actor` (строка для аудита).
- Адаптер **возвращает наблюдения**: любой результат снабжён `observed_at`;
  ошибки типизированы (`ErrUnavailable`, `ErrTimeout`, `ErrNotFound`,
  `ErrUnsupported`, `ErrInvalidArgument`, `ErrConflict`).
- Адаптер **объявляет возможности** (`Capabilities`). Вызов необъявленной
  возможности возвращает `ErrUnsupported`; интерфейс показывает `unknown`, а не
  ошибку.
- Адаптер **переводит состояния** в канонический словарь
  ([states.md](states.md)) и сохраняет оригинал в `Raw`.
- Локальные идентификаторы бекенда непрозрачны для Admin API и передаются в
  URL как `{backend}/{id}`. Связь с аккаунтом — только через `AccountID`
  (amoCRM account id) и `ProductCode` (код продукта каталога).

## Интерфейс (Go, черновик)

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
    Diagnostics, Commands, Settings, Stats bool // этапы 2–4
    ActivityDeliveries bool
}

type Observation[T any] struct {
    Source     string
    ObservedAt time.Time
    Data       T
}

type Backend interface {
    Descriptor() Descriptor
    Capabilities() Capabilities
    Health(ctx context.Context) (Observation[Health], error)

    ListAccounts(ctx context.Context, f AccountFilter) (Observation[Page[Account]], error)
    GetAccount(ctx context.Context, accountID int64) (Observation[Account], error)

    ListConnections(ctx context.Context, f ConnectionFilter) (Observation[Page[Connection]], error)
    GetConnection(ctx context.Context, id string) (Observation[ConnectionDetail], error)
    ListConnectionJobs(ctx context.Context, id string, f JobFilter) (Observation[Page[Job]], error)
    ListConnectionAudit(ctx context.Context, id string, f PageFilter) (Observation[Page[AuditEntry]], error)

    ListIntegrations(ctx context.Context) (Observation[[]Integration], error)
    GetIntegration(ctx context.Context, id string) (Observation[Integration], error)

    ListJobs(ctx context.Context, f JobFilter) (Observation[Page[Job]], error)
    GetJob(ctx context.Context, id string) (Observation[JobDetail], error)
    JobsSummary(ctx context.Context) (Observation[JobsSummary], error)
}
```

Типы данных (`Account`, `Connection`, `ConnectionDetail`, `Authorization`,
`Webhook`, `Grant`, `ActivityFacts`, `Job`, `JobAttempt`, `AuditEntry`,
`Integration`, `Health`) содержат только канонические состояния и безопасные
факты; никаких секретов, ciphertext, payload.

Этап 2 добавляет отдельный интерфейс `Commander` (проверка подключения,
enable/disable, revoke, uninstall, reconcile, retry) с `Idempotency-Key` и
результатом `OperationResult{State, Outcome, Details}`; этап 3 — `Settings`,
`Stats`; этап 4 — версионирование (`ContractVersion`), состояние доступности,
версия и время последнего ответа в реестре бекендов.

## Реестр и агрегация

`accounts.Service` держит список адаптеров из `deploy/backends.yaml`, опрашивает
их параллельно с индивидуальными таймаутами (`errgroup` + `context.WithTimeout`),
собирает `sources[]` и объединяет аккаунты по `AccountID`. Отказ одного
адаптера → `sources[i].status = unavailable`, остальные данные возвращаются.

Пагинация при нескольких бекендах — по каждому бекенду отдельно с составным
курсором `{backend: cursor}`; на этапе 1 с одним бекендом это прозрачно.

## Конфигурация

```yaml
# deploy/backends.yaml
backends:
  - code: core
    kind: core-http
    base_url: http://host.docker.internal:18083   # dev: admin listener пилотного стека
    token_env: CORE_ADMIN_API_TOKEN
    timeout: 5s
    products: [lead-status, activity]
```

Секреты — только через переменные окружения, имя которых указано в
`token_env`. Файл коммитится без секретов.
