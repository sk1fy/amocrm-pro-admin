# Поле интерфейса → источник данных → API

Обязательная таблица. Любое новое поле интерфейса добавляется сюда до реализации.
Столбец «Core admin read» — endpoint нового listener в `amocrm-pro`
(см. [admin-api.md](admin-api.md)); «Admin API» — endpoint этого репозитория.
Все таблицы — Core PostgreSQL, если не указано иное. Секретные колонки
(`client_secret_ciphertext`, `access_token_ciphertext`,
`refresh_token_ciphertext`, `webhook_key_hash`, `webhook_key_ciphertext`,
ключи шифрования, `ENCRYPTION_KEYS`) не читаются ни одним endpoint.

## Вход сотрудника

Email и пароль вводит сотрудник; данные передаются существующему
`POST /api/v1/auth/login`. Переключатель видимости пароля и индикатор
отправки — локальное состояние формы, не новые поля API. Декоративная
композиция не содержит фактов о состоянии сервиса или аккаунтов.

## Аккаунт

| Поле | Источник | Core admin read | Admin API | Статус |
| --- | --- | --- | --- | --- |
| `account_id` | `installations.account_id` (GROUP BY) | `GET /admin/v1/accounts` | `GET /api/v1/accounts`, `GET /api/v1/accounts/{id}` | новый |
| Домены | `array_agg(DISTINCT installations.account_domain)` | там же | там же | новый |
| Число подключений и разбивка по состояниям | `count(*)`, `count(*) FILTER (WHERE status=…)` | там же | там же | новый |
| Последняя активность | `max(installations.updated_at)` | там же | там же | новый |
| Агрегированное состояние | вычисляется в Admin API по [states.md](states.md) | — | там же | новый |
| Происхождение (`real`/`fixture`) | `installations.settings->>'origin'` = `fixture` | там же | там же | новый |
| Проблемы аккаунта, фильтр `problem` и счётчики «Требуют внимания» | вычисляются в Admin API из подключений (статус, webhook, авторизация, failed/dead jobs за 24 ч) | `GET /admin/v1/accounts` отдаёт `webhook_status`, `authorization_state`, `recent_failed_jobs` и `total` | `GET /api/v1/accounts?problem=`, Обзор | новый |
| Рекомендуемое действие по типу проблемы | вычисление UI по коду `problem` | — | ссылка `/accounts?problem=` на Обзоре | UI 2026-09-14 |
| Подписка: `plan`, `state`, `expires_at`, `capabilities` | адаптер `SubscriptionBackend.GetSubscription`; fixture — `Subscriptions` для 91000001/91000002/91000003/91000005 (у 91000004/91000006 факта нет) | Core capability `subscriptions` не объявляет | `GET /api/v1/accounts/{account_id}/subscription` | есть; ADR-0012 |
| Подписка: правило unknown и границы | опрашиваются только бекенды с capability `subscriptions`; пустой `items` — «данные подписки недоступны», не «нет подписки»; `Subscription` не `Grant` | — | там же | есть; ADR-0012 |
| Пользователи/контакты аккаунта | надёжного источника нет | — | — | не в этапах 1–4 без нового источника |

## Подключение (installation)

| Поле | Источник | Core admin read | Admin API | Статус |
| --- | --- | --- | --- | --- |
| Итог подключения `connection_health` и причины | вычисление UI из Observation карточки ([ADR-0015](../adr/0015-connection-diagnostics-ux.md)) | — | карточка подключения | UI 2026-09-14 |
| Вкладки `section` включая «Технические данные» (`tech`) | те же Observation карточки: UUID, версии, source, Grafana/Loki | — | карточка подключения `?section=tech` | UI 2026-09-14 |
| Webhook: последняя успешная проверка | `webhook_checked_at`, только если нет `webhook_last_error`; иначе «Проверено» без слова «успешная». Ожидаемые vs зарегистрированные события не показываются: в API карточки нет пары expected/registered | там же | карточка, вкладка Webhook | UI 2026-09-14 |
| Длительность последнего синка | вычисление UI: `last_success_at − last_event_at`, только если интервал > 0 и ≤ 24 ч; иначе поле скрыто | `activity/status` | карточка Activity и настройки | UI 2026-09-14 |
| `installation_id`, `integration_id`, `account_id`, `account_domain` | `installations` | `GET /admin/v1/installations`, `GET /admin/v1/installations/{id}` | `GET /api/v1/connections/core/{id}` | новый |
| Состояние подключения | `installations.status` | там же | там же | новый |
| `installed_by` | `installations.installed_by` | там же | там же | новый |
| Даты создания/обновления | `installations.created_at/updated_at` | там же | там же | новый |
| Webhook: состояние, события, `checked_at`, `last_error` | `installations.webhook_status`, `webhook_settings`, `webhook_checked_at`, `webhook_last_error` | там же | там же | новый |
| Webhook: подтверждённые адреса доставки (кол-во, без URL) | `installation_webhook_destinations` (миграция 000015) — только `count`, `created_at`; URL зашифрованы и не читаются; в UI «подтверждённые адреса доставки», 0 при active — предупреждение | там же | там же | новый |
| Авторизация: наличие, `expires_at`, `credential_version` (колонка `token_version`), `refreshed_at`, `key_version`, lease активна | `oauth_credentials` (без `*_ciphertext`) | там же | там же | новый; JSON-ключ `credential_version`, чтобы не содержать подстроку `token` |
| Авторизация: результат проверки к amoCRM | внешний вызов через `amocrm.Client` в worker/Gateway | `POST /admin/v1/installations/{id}/commands/check` | операция | есть |
| Гранты сервисов интеграции | `integration_services` | вложено в installation/integration | там же | новый |
| Activity pilot | `activity_pilots.enabled` | вложено в `GET /admin/v1/installations/{id}` | там же | новый |
| Activity доставка команд | `activity_command_receipts` ⋈ `activity_command_outbox` (`action`, `target`, `status`, `attempts`, `error_code`, `created_at`) — то же, что `activitybridge.ListDeliveries` | `GET /admin/v1/installations/{id}/activity/deliveries` | там же | новый (переиспользовать `ListDeliveries`/`InspectDelivery`) |
| Activity синхронизация (`SyncStatus`) | CRM Events `Status`; unix 0 → `null`; неизвестный state → `unknown`+`raw`. `not_enabled` — отдельное состояние, не «нулевая активность» | `GET /admin/v1/installations/{id}/activity/status` | `GET …/activity/status`, карточка `activity_sync` | есть |
| Activity настройки | Activity `Settings` + `updated_at` unix (0 = defaults never saved) | `GET /admin/v1/installations/{id}/activity/settings` | `GET …/activity/settings`; команда `activity-configure` | есть |
| Activity панели и сотрудники | Activity `ManagedPanel` / users; без `view_key`/`share_url` | `GET …/activity/panels`, `…/panels/{id}`, `…/employees` | те же пути Admin API | есть |
| Lead-status правила | `lead_status_workflow_rules`, CAS revision | `GET …/lead-status/rules` | `GET …/lead-status/rules`; команда `lead-status-configure` | есть |
| Lead-status запуски | `workflow_runs`, skip/error reason, effect | `GET …/lead-status/runs` | `GET …/lead-status/runs` (`operations:read`) | есть |
| Настройки установки `settings` | `installations.settings` | не выводить целиком; только `origin` | — | решение о редакции отдельно |

## Интеграция

| Поле | Источник | Core admin read | Admin API | Статус |
| --- | --- | --- | --- | --- |
| `id`, `code`, `client_id`, `status`, `redirect_uri`, `webhook_events`, даты | `integrations` (без `client_secret_ciphertext`) | `GET /admin/v1/integrations`, `GET /admin/v1/integrations/{id}` | `GET /api/v1/integrations`, `GET /api/v1/integrations/core/{id}` | новый |
| Каталог: хост редиректа и число событий webhook | `redirect_uri` (host, полный URL в `title`); `webhook_events` — счётчик с раскрытием по сущностям | там же | каталог `/widgets`, карточка интеграции | UI 2026-09-14 |
| Версия ключа секрета и дата ротации | `integrations.client_secret_key_version`, `updated_at` | там же | там же | новый; сам секрет не читается |
| Сервисы и гранты | `integration_services` | там же | там же | новый |
| Счётчики подключений по состояниям | `installations` GROUP BY `integration_id, status` | там же | там же | новый |
| `settings` интеграции | `integrations.settings` | не выводить до отдельного решения | — | отложено |

## Задачи и попытки

| Поле | Источник | Core admin read | Admin API | Статус |
| --- | --- | --- | --- | --- |
| Job: `id`, `installation_id`, `account_id`, `type`, `status`, `priority`, `attempts`, `max_attempts`, `run_after`, `last_error_code`, `last_error_message`, даты | `jobs` (без `payload`, `result`, `locked_by`) | `GET /admin/v1/jobs`, `GET /admin/v1/installations/{id}/jobs` | `GET /api/v1/operations/jobs`, таблица задач, ссылка на подключение | новый |
| Длительность задачи в таблице | `finished_at - created_at`; без `finished_at` — «—» | те же поля job | таблица задач, карточка задачи | UI 2026-09-14 |
| Карточка задачи: безопасные поля, попытки, ссылка на подключение | job + `GET …/jobs/{backend}/{id}` (`attempts`); `payload`/`result` не показываются | `GET /admin/v1/jobs/{id}` | `GET /api/v1/operations/jobs/{backend}/{id}` | UI 2026-09-14 |
| Job: инициатор и ресурс (`actor_type`, `actor_id` — ID пользователя amoCRM, `resource_type`, `resource_id`) | `jobs` (миграция 000002) | там же | там же | новый |
| Попытки: `attempt`, `worker_id`, `started_at`, `finished_at`, `outcome`, `error_code`, `error_message`, `duration_ms` | `job_attempts` | `GET /admin/v1/jobs/{id}` | `GET /api/v1/operations/jobs/core/{id}` | новый |
| Размер очередей по состояниям | `jobs` GROUP BY `status` (или метрики backlog) | `GET /admin/v1/jobs/summary` | Обзор | новый; согласовать с `jobs.BacklogMetrics` |
| Workflow/эффекты lead-status | `workflow_runs`, `outbound_effects` | `GET …/lead-status/runs` | история на экране настроек | есть |

## История

| Поле | Источник | Core admin read | Admin API | Статус |
| --- | --- | --- | --- | --- |
| Аудит Core по установке/интеграции | `audit_log` (`installation_id`, `object_type`, `object_id`, `actor_type`, `actor_id`, `action`, `metadata`, `correlation_job_id`, `created_at`) | `GET /admin/v1/audit?installation_id=&object_type=&object_id=` | вкладка История, карточка интеграции | новый; `metadata` уже без секретов (runbook integrations); `correlation_job_id` — ссылка на job |
| Аудит действий сотрудников | admin DB `admin_audit_log` | — | `GET /api/v1/system/audit` | новый |
| Фильтр аудита по сотруднику | admin DB `employees` (id, name, email) | — | `GET /api/v1/system/employees` → query `employee_id` аудита | UI 2026-09-14 |
| Подпись действия аудита | словарь UI `auditLabel`; фильтр `action` как точное значение API | — | query `action` | UI 2026-09-14 |

## Система

| Поле | Источник | Core admin read | Admin API | Статус |
| --- | --- | --- | --- | --- |
| Реестр: `backend`, `kind`, `display_name`, `products` | конфигурация `deploy/backends.yaml` + `Descriptor`/продукты адаптера | `GET /admin/v1/backend` даёт `backend` | `GET /api/v1/system/backends`, `items[]` | есть |
| Реестр: `status` (`available`/`unavailable`/`unknown`) | `catalog.Registry.Probe`: кеш 10 с, персональный таймаут `Descriptor().Timeout` (запас 5 с) | — | там же | есть; `degraded` зарезервирован, [states.md](states.md) |
| Реестр: `contract_version`, `revision` | `Descriptor().ContractVersion`; после успешного `Health` — `health.revision` | `GET /admin/v1/backend` (`contract_version`, `revision`) | там же | есть; ADR-0011 |
| Реестр: `adapter_capabilities[]`, `backend_capabilities[]` | `Capabilities().Names()`; `health.capabilities` последнего успешного ответа | `GET /admin/v1/backend` (`capabilities`) | там же | есть; ADR-0011 |
| Реестр: `observed_at`, `checked_at`, `error{code,message}` | `observed_at` — последний успешный ответ (переживает отказ, может быть `null`), `checked_at` — последняя проба, `error` — безопасная ошибка | — | там же | есть |
| Реестр: таблица vs карточка | таблица: имя, тип, статус, контракт, последняя проверка, ошибки; ревизия SHA, возможности, продукты, компоненты JSON — карточка | — | там же | UI 2026-09-14 |
| Компоненты Activity/CRM Events (режим, readiness) | management `GET /components`, `GET /components/activity/ready` — другой listener | `health.components` из `GET /admin/v1/backend` | там же | новый; management порт наружу не открывать |
| Сотрудники, роли, статусы | admin DB `employees` | — | `GET/POST/PATCH /api/v1/system/employees` | новый |
| Сессии | admin DB `sessions` | — | `GET /api/v1/me/sessions`, `DELETE …/{id}` | новый |
| Каталог продуктов | конфигурация `deploy/backends.yaml` + `services.Components()` Core | `GET /admin/v1/backend` | `GET /api/v1/catalog` | новый |

## Правила заполнения

- «Статус» — `есть`, `новый` или `UI YYYY-MM-DD` (реализовано;
  `новый` — поле админки, которого не было в публичном API Core),
  `отложено` (с причиной), `не в этапах` (нет источника).
- Поле без строки в таблице не реализуется.
- Если источник — вычисление, указать формулу словами или SQL-агрегат.
- Для каждого показателя статистики добавляются столбцы «формула»,
  «период», «свежесть».

### Исправления после проверки этапа 1

- Продукт аккаунта: `AccountInstallation.grants` Core, только `enabled=true`;
  код сервиса каталога, а не код OAuth-интеграции.
- Ошибки задач в карточке: `InstallationSummary.recent_failed_jobs` Core;
  одинаковое окно 24 часа для списка и карточки.
- Факты OAuth карточки: исходный `Authorization` Core, включая `unverified`,
  наличие credentials, сроки и версии; не конструируются из одного state.
- Задачи аккаунта: Admin `/accounts/{account_id}/jobs`, слияние списков
  задач подключений; `backend` у каждой строки берётся из адаптера.
- Подключения интеграции: список аккаунтов с `integration_id` и `backend`.

## Управление

| Поле | Источник |
| --- | --- |
| Операции, инициатор, команда, state/result | admin DB operations, через /operations/admin |
| Результат Core-команды | Core command receipt, без повторной отправки |
| authorization_check.classification/observed_at | Подтверждённый результат последней check-квитанции; внешний вызов worker |
| authorization_check.freshness | Core: stale после 90 минут; Admin fallback 15 минут для старого Core |
| job.retry_allowed | Core policy: allowlist + состояние job/установки/интеграции |
| delivery.retry_allowed | failed и возраст менее 7 суток; Core дополнительно сверяет owner |
| oauth_start_url после revoke | Ответ Core, публичная OAuth start ссылка |
| webhook_error при partial uninstall | Редактированный результат worker Core |
| request_key lookup | Индекс идемпотентности Admin; тело команды не требуется |

Секрет интеграции передаётся только при create/rotate-secret. Его текущее
значение не читается, не показывается и не сохраняется в истории операций.

Состояние задачи после команды с `outcome=queued` — отдельный Observation
из `GET /api/v1/operations/jobs/{backend}/{job_id}`. `job_id` берётся из
безопасного результата операции; подтверждение постановки не означает
успешного выполнения.

## Activity, статистика, представления

Все агрегаты статистики — один snapshot с общим `observed_at`. Окно
выбранного `period` (`24h`/`7d`/`30d`; по умолчанию `7d`, как в Core)
применяется к показателям периода; `queues` и `sync_problems` считаются
по фиксированным 7 суткам независимо от `period` (см. таблицу). `null`
и `0` различны. Интерфейс (Обзор, «Аккаунты показателя») по умолчанию
использует `24h` и всегда передаёт `period` явно; `7d` — умолчание
Admin API при отсутствии параметра, совпадающее с Core.
История подключений до включения сбора не реконструируется:
`connected`/`disconnected` только по `audit_log` с момента появления
Core admin.

| Поле | Формула | Период | Свежесть | Источник | Admin API |
| --- | --- | --- | --- | --- | --- |
| Подключения по коду интеграции и состоянию | `COUNT(*)` snapshot `installations` GROUP BY `integrations.code`, `installations.status`; продукт — код интеграции, без гранта сервиса | текущий снимок | `observed_at` запроса | `GET /admin/v1/stats` | `GET /api/v1/stats` |
| Новые подключения | `COUNT(DISTINCT installation_id)` audit `installation.authorized` в окне | 24h/7d/30d | там же | там же `connected` | там же |
| Отключения | `COUNT(DISTINCT installation_id)` disable/uninstall/revoke в окне | 24h/7d/30d | там же | `disconnected` | там же |
| Активные аккаунты | distinct `account_id` с job или updated_at в окне | 24h/7d/30d | там же | `active_accounts` | там же |
| Последнее использование | `max(installations.updated_at, jobs.updated_at)` в окне; не `used_widget_tokens` | 24h/7d/30d | там же | `last_use_at` | там же |
| Ошибки задач | `COUNT` jobs failed/dead в окне | 24h/7d/30d | там же | `job_errors` | там же |
| Задержка p50 | percentile `job_attempts.duration_ms`; нет попыток → `null` | 24h/7d/30d | там же | `latency_p50_ms` | там же |
| Очереди | `COUNT(*)` jobs за `updated_at > now() - interval '7 days'` GROUP BY type, status | фиксированные 7 суток | там же | `queues[]` | там же |
| Проблемы авторизации | `COUNT(*)` installations `status='reauth_required'` только; `missing_credentials` не входит | текущий снимок | там же | `auth_problems` | список `/stats/accounts?metric=` |
| Проблемы синхронизации | `COUNT(DISTINCT installation_id)` по `activity_command_outbox.status='failed'` × receipts; Core-видимый сбой доставки (не полный CRM Events Status) | фиксированные 7 суток, выбранный `period` не влияет | там же | `sync_problems` | там же |
| Сохранённые представления | admin DB `saved_views` | — | запись | — | `GET/POST/PATCH/DELETE /api/v1/views` |
| Grafana/Loki | env `GRAFANA_BASE_URL`/`LOKI_BASE_URL`; id только в query URL | интервал UI | конфиг процесса | — | поле `observability` в `/system/backends` |

## Реестр, подписки, наблюдаемость, retention

Реестр бекендов и подписки описаны в таблицах выше; эксплуатационные
артефакты:

| Поле / артефакт | Источник | Admin API / команда | Статус |
| --- | --- | --- | --- |
| Метрики HTTP | `platform/metrics`: `route` (шаблон chi), `method`, `status` | `/metrics` на management listener (только внутренняя сеть) | ADR-0013 |
| Метрики бекендов | `ObserveBackendProbe`: `outcome`, `up`, время последнего ответа | там же | ADR-0013 |
| Retention/prune | аудит 365 суток, терминальные операции 180, истёкшие/отозванные сессии 30 | `admin-cli prune` (dry-run по умолчанию, `--confirm`); миграция `000006_retention_indexes` | ADR-0014 |
| Backup/restore | `pg_dump --format=custom`; проверка в черновую БД | `make backup-db`, `make restore-check RESTORE_CONFIRM=restore-check` | [operator.md](../runbooks/operator.md) |
| Нагрузка больших списков | fixture 10⁴/10⁵ аккаунтов, EXPLAIN Core admin read | `make bench-admin` | [stage-4-load-2026-09-13.md](../reviews/stage-4-load-2026-09-13.md) |

Политика labels: только конечные значения; ID аккаунтов, установок,
сотрудников, job и сессий, email, домены и request id запрещены
([ADR-0013](../adr/0013-admin-metrics.md)).

### Код обращения при отказе входа

Источник: `error.request_id` или `X-Request-ID` ответа Admin API.
Показывается только с сообщением временной недоступности на экране входа.
При сетевом отказе без ответа код обращения отсутствует.

## Актуальность установок (2026-09-19)

| Поле | Источник | Правило |
| --- | --- | --- |
| summary.authorization_check | Core installation_checks + receipt | Только текущая версия credentials и состояние |
| classification | Завершённый Core check | Не выводится из active |
| observed_at проверки | Время фактической попытки | Отдельно от HTTP снимка |
| freshness проверки | Core на чтении | 90 минут, включительно на границе |
| fresh_for_seconds | Core connectioncheck.FreshFor | 5400, UI только показывает |
| stats.verification.unverified | Core aggregate | active, unknown или stale |
| stats.verification.temporary_errors | Core aggregate | active, network/429/internal |
| Обновлено | Query dataUpdatedAt | Время получения backend-снимка браузером |

Новое поле optional. Старый Core без него совместим; в списке это unknown,
в карточке доступна прежняя ручная квитанция. Unknown нового Core не включает
fallback, поэтому старая ошибка после новой OAuth-сессии не возвращается.
Недоступный Core помечает его факты unavailable. См.
[ADR-0017](../adr/0017-connection-state-freshness.md).
