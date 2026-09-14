# Этап 3. Управление текущими модулями и статистика

> Статус: завершён. Документ сохранён как исторический план и отчёт приёмки;
> текущий backlog находится в [README](README.md).

**Цель:** закрыть работу с Activity, lead-status и сводной аналитикой
платформы.

**Зависимости:** механизм операций этапа 2; решение об административном
контексте авторизации для портов Activity/CRM Events.

## Объём

Сверка 2026-09-13. Core `6f1a19c` (`feature/admin-commands` →
`feature/admin-activity`). Admin `f3cc3b5` (`feature/stage-2-operations` →
`feature/stage-3-modules`).

Фактический контракт `serviceapi` (`internal/serviceapi/contracts.go`,
`panels.go`):

- `Settings{initial_days, retention_days}`; default 2/7; CAS по
  `command_id`+hash, колонки `revision` у настроек нет (`updated_at`
  в Activity DB). Validate: initial 1–7, retention 2–30, initial ≤
  retention.
- `SyncStatus`: `state`, `verification` (`stabilized_api_scan`),
  `enabled`, unix-поля `history_from/verified_from/verified_through/
  window_from/window_to/last_success_at/last_event_at`, `lag_seconds`,
  `error_code`, `reauth_required`. Нет source → `state=not_enabled`.
  Состояния источника: `pending`, `idle`, `running`, `disabled`,
  `paused`, `failed`, `reauth_required`, `not_enabled`.
- `Command.kind`: `enable|sync|backfill|disable`; backfill ≤ 31×86400
  и не старше `retention_days`; 7-суточный горизонт outbox
  (`RedeliveryHorizon`).
- `Operation.state`: `accepted|running|retry|paused|failed|succeeded`.
- Панели: `ManagedPanel` с `revision` CAS, окно `HH:MM`,
  ≤ 50 панелей, 1–100 сотрудников; HTTP `/api/v1/activity/panels*`.

Авторизация портов (ADR-0011/0024): виджет — amoCRM admin через
`GetUserAuthorization`; панели — `PrincipalKindOperator` после
management token + `withManagementScope`. Operator grants сейчас
только `activity/panels` + `gateway/users`. **Admin principal для
settings/status/sync отсутствует** — без ADR-0028 Core `SyncStatus`
остаётся `unknown`.

Lead-status: `internal/services/leadstatus`, revision CAS (ADR-0007),
правила меняет виджетный админ amoCRM (`actor_type=widget_user`).
HTTP admin/CLI для правил нет. Jobs lead-status в admin read-only
(ADR-0027).

Статистика: в Core admin есть `jobs/summary` (GROUP BY status) и
`recent_failed_jobs` за 24 ч. Нет агрегатов подключений, audit
install/OAuth за период, очередей по типу, `used_widget_tokens`
для last-use (нет индекса по account, таблица JWT replay — не
использовать). Grafana/Loki URL в admin конфиге нет.

CLI `activity-control`: list/inspect/retry/pilot/panel-*; **нет**
settings/sync/backfill.

## Части

### 3.1. Административный контекст для Activity

Порты Activity требуют проверенного актора (ADR-0011): сейчас это админ amoCRM
из browser JWT либо management token для панелей. Нужен явный административный
принципал: Core выдаёт `serviceapi.Auth` для `X-Admin-Actor` с ограниченной
областью (installation + integration) — по образцу `withManagementScope`.
Решение — ADR в `amocrm-pro`; без него sync status остаётся `unknown`.

### 3.2. Activity

- Настройки аккаунта (`initial_days`, `retention_days`) с revision/version:
  конфликт → `conflict` и показ актуального значения.
- Статус синхронизации: `state`, `verification`, `verified_from/through`,
  `last_success_at`, `last_event_at`, `lag_seconds`, `reauth_required`;
  правило «unknown/partial/stale ≠ нулевая активность».
- Команды `sync` `kind=enable|sync|backfill|disable` с `Idempotency-Key`,
  отслеживание операции до `succeeded`/`failed`; «202 ≠ завершено».
- Панели: список, создание, изменение, сотрудники и окно, включение/
  отключение, ротация ссылок (существующие `panel-*` в `activity-control` и
  `/api/v1/activity/panels*`).
- Старый экран `RkrsActivityPanelPage` — только как источник сценария
  («последний синк», «мин/макс дата», «статус синка», «текст ошибки»,
  «Синхронизировать с даты»).

### 3.3. Lead-status

Просмотр правил (`lead_status_workflow_rules`), изменение через прикладную
логику модуля `leadstatus` (revision CAS, ADR-0007), история применения
(`workflow_runs`, `outbound_effects`), причина ошибки/пропуска. Полномочия
сотрудников для административного изменения правил определить явно (сейчас
правила меняет админ amoCRM через виджет).

### 3.4. Статистика

Для каждого показателя — формула, источник, период, свежесть в
[data-sources.md](../design/data-sources.md):

- подключения по продуктам и состояниям (снимок `installations`);
- новые подключения и отключения за период (`audit_log` по действиям
  installation/OAuth; при недостатке — собственные агрегаты admin DB, собираемые
  с момента включения; история до начала сбора не реконструируется);
- активные аккаунты и последнее использование (`jobs`/`used_widget_tokens`
  по установке — проверить допустимость и стоимость запроса);
- ошибки и задержки обработки (`jobs`, `job_attempts.duration_ms`; сверка с
  метриками backlog);
- очереди по сервисам (`jobs` GROUP BY тип/сервис);
- списки аккаунтов с проблемами авторизации и синхронизации.

Согласованность: сводка и детализация за один период считаются одним
источником/запросом.

### 3.5. Интерфейс диагностики

Переход показатель → список аккаунтов с фильтром; готовые фильтры проблем;
сохранённые представления и колонки (таблица `saved_views` в admin DB); ссылки
в Grafana/Loki с интервалом и идентификаторами в query (не в labels
Prometheus).

## Приёмка

- Настройки Activity сохраняются и повторно читаются в применённом состоянии.
- Конкурентное изменение не перезаписывается молча.
- Синхронизация отслеживается до результата.
- Правила lead-status сохраняют существующие гарантии.
- Сводные показатели согласованы с детализацией за тот же период.
- Интерфейс различает отсутствие данных и нулевое значение.

## Отчёт

Дата: 2026-09-13. Ветки (ещё не слиты): Admin
`feature/stage-3-modules` от `f3cc3b5`; Core `feature/admin-activity`
от `6f1a19c`.

### Реализованные экраны и операции
- Карточка подключения: `SyncStatus` как Observation (state, lag,
  last_success/event, verified range, reauth); ссылки Grafana/Loki.
- `/accounts/.../settings`: настройки Activity с
  `expected_updated_at`; sync enable/sync/backfill/disable (опрос до
  terminal, «202 ≠ завершено»); панели create/patch/rotate без
  секрета ссылки; правила и запуски lead-status с revision CAS.
- Обзор: статистика периода 24h/7d/30d; ноль vs «—»; переход к
  `/stats/accounts`. Saved views на списке аккаунтов.

### Изменения контрактов и миграции
- Admin API: GET activity/settings|status|panels|employees,
  lead-status/rules|runs, `/stats`, `/stats/accounts`, CRUD `/views`.
  Команды: `activity-configure`, `activity-sync`,
  `activity-panel-create|patch|rotate`, `lead-status-configure`.
- Core admin: те же GET на listener; Issue `Kind=operator`,
  `actor_id=0` (ADR-0028); sync receipt pending до CRM Events.
- Миграции admin DB: `000005_saved_views`. Core:
  `000017_admin_activity_principal` (`actor_id >= 0` в receipts и
  rule configurations); Activity `000003_operator_actor`.

### Результаты проверок
| Команда | Репозиторий | Результат |
| --- | --- | --- |
| make test | amocrm-pro | ok (агент Core) |
| make openapi-check | amocrm-pro | ok |
| make test | amocrm-pro-admin | ok (Go race + Vitest) |
| make integration-test | amocrm-pro-admin | ok, включая stage-3 |
| make e2e | amocrm-pro-admin | 16 сценариев ok |

Отдельный субагент проверки запускается после этого отчёта.

### Инструкция запуска и демонстрационный сценарий
- docs/runbooks/local-run.md
- docs/runbooks/demo-stage-3.md

### Происхождение данных демонстрации
- fixture: Demo adapter (`origin=fixture`), e2e-стек.
- real: пилотный Core `feature/admin-activity` после миграций
  000017 и activity/000003.

### Ограничения и зависимости следующего этапа
- `used_widget_tokens` не используется для last-use (нет индекса,
  таблица JWT replay).
- Проблемы синка в сводке — failed outbox за 7 суток, не полный
  CRM Events Status по всем установкам.
- Новая ссылка панели после rotate в админке не показывается
  (секрет остаётся в Activity).
- Вызовы Activity из admincommand идут внутри Core-транзакции
  квитанции — вынести внешние вызовы за tx на этапе 4 при нагрузке.
- Этап 4: адаптер v1 freeze, будущие бекенды, Grafana coverage.
- Grafana/Loki — только ссылки из env, без покрытия метрик.
