# Поле интерфейса → источник данных → API

Обязательная таблица. Любое новое поле интерфейса добавляется сюда до реализации.
Столбец «Core admin read» — endpoint нового listener в `amocrm-pro`
(см. [admin-api.md](admin-api.md)); «Admin API» — endpoint этого репозитория.
Все таблицы — Core PostgreSQL, если не указано иное. Секретные колонки
(`client_secret_ciphertext`, `access_token_ciphertext`,
`refresh_token_ciphertext`, `webhook_key_hash`, `webhook_key_ciphertext`,
ключи шифрования, `ENCRYPTION_KEYS`) не читаются ни одним endpoint.

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
| Пользователи/контакты аккаунта | надёжного источника нет | — | — | не в этапах 1–4 без нового источника |

## Подключение (installation)

| Поле | Источник | Core admin read | Admin API | Статус |
| --- | --- | --- | --- | --- |
| `installation_id`, `integration_id`, `account_id`, `account_domain` | `installations` | `GET /admin/v1/installations`, `GET /admin/v1/installations/{id}` | `GET /api/v1/connections/core/{id}` | новый |
| Состояние подключения | `installations.status` | там же | там же | новый |
| `installed_by` | `installations.installed_by` | там же | там же | новый |
| Даты создания/обновления | `installations.created_at/updated_at` | там же | там же | новый |
| Webhook: состояние, события, `checked_at`, `last_error` | `installations.webhook_status`, `webhook_settings`, `webhook_checked_at`, `webhook_last_error` | там же | там же | новый |
| Webhook: подтверждённые destinations (кол-во, без URL) | `installation_webhook_destinations` (миграция 000015) — только `count`, `created_at`; URL зашифрованы и не читаются | там же | там же | новый |
| Авторизация: наличие, `expires_at`, `credential_version` (колонка `token_version`), `refreshed_at`, `key_version`, lease активна | `oauth_credentials` (без `*_ciphertext`) | там же | там же | новый; JSON-ключ `credential_version`, чтобы не содержать подстроку `token` |
| Авторизация: результат проверки к amoCRM | внешний вызов через `amocrm.Client` в worker/Gateway | `POST /admin/v1/installations/{id}/commands/check` | операция | этап 2 |
| Гранты сервисов интеграции | `integration_services` | вложено в installation/integration | там же | новый |
| Activity pilot | `activity_pilots.enabled` | вложено в `GET /admin/v1/installations/{id}` | там же | новый |
| Activity доставка команд | `activity_command_receipts` ⋈ `activity_command_outbox` (`action`, `target`, `status`, `attempts`, `error_code`, `created_at`) — то же, что `activitybridge.ListDeliveries` | `GET /admin/v1/installations/{id}/activity/deliveries` | там же | новый (переиспользовать `ListDeliveries`/`InspectDelivery`) |
| Activity синхронизация (`SyncStatus`) | CRM Events `Status`; unix 0 → `null`; неизвестный state → `unknown`+`raw`. `not_enabled` — отдельное состояние, не «нулевая активность» | `GET /admin/v1/installations/{id}/activity/status` | `GET …/activity/status`, карточка `activity_sync` | этап 3 |
| Activity настройки | Activity `Settings` + `updated_at` unix (0 = defaults never saved) | `GET /admin/v1/installations/{id}/activity/settings` | `GET …/activity/settings`; команда `activity-configure` | этап 3 |
| Activity панели и сотрудники | Activity `ManagedPanel` / users; без `view_key`/`share_url` | `GET …/activity/panels`, `…/panels/{id}`, `…/employees` | те же пути Admin API | этап 3 |
| Lead-status правила | `lead_status_workflow_rules`, CAS revision | `GET …/lead-status/rules` | `GET …/lead-status/rules`; команда `lead-status-configure` | этап 3 |
| Lead-status запуски | `workflow_runs`, skip/error reason, effect | `GET …/lead-status/runs` | `GET …/lead-status/runs` (`operations:read`) | этап 3 |
| Настройки установки `settings` | `installations.settings` | не выводить целиком; только `origin` | — | решение о редакции отдельно |

## Интеграция

| Поле | Источник | Core admin read | Admin API | Статус |
| --- | --- | --- | --- | --- |
| `id`, `code`, `client_id`, `status`, `redirect_uri`, `webhook_events`, даты | `integrations` (без `client_secret_ciphertext`) | `GET /admin/v1/integrations`, `GET /admin/v1/integrations/{id}` | `GET /api/v1/integrations`, `GET /api/v1/integrations/core/{id}` | новый |
| Версия ключа секрета и дата ротации | `integrations.client_secret_key_version`, `updated_at` | там же | там же | новый; сам секрет не читается |
| Сервисы и гранты | `integration_services` | там же | там же | новый |
| Счётчики подключений по состояниям | `installations` GROUP BY `integration_id, status` | там же | там же | новый |
| `settings` интеграции | `integrations.settings` | не выводить до отдельного решения | — | отложено |

## Задачи и попытки

| Поле | Источник | Core admin read | Admin API | Статус |
| --- | --- | --- | --- | --- |
| Job: `id`, `installation_id`, `account_id`, `type`, `status`, `priority`, `attempts`, `max_attempts`, `run_after`, `last_error_code`, `last_error_message`, даты | `jobs` (без `payload`, `result`, `locked_by`) | `GET /admin/v1/jobs`, `GET /admin/v1/installations/{id}/jobs` | `GET /api/v1/operations/jobs`, таблица задач, ссылка на подключение | новый |
| Job: инициатор и ресурс (`actor_type`, `actor_id` — ID пользователя amoCRM, `resource_type`, `resource_id`) | `jobs` (миграция 000002) | там же | там же | новый |
| Попытки: `attempt`, `worker_id`, `started_at`, `finished_at`, `outcome`, `error_code`, `error_message`, `duration_ms` | `job_attempts` | `GET /admin/v1/jobs/{id}` | `GET /api/v1/operations/jobs/core/{id}` | новый |
| Размер очередей по состояниям | `jobs` GROUP BY `status` (или метрики backlog) | `GET /admin/v1/jobs/summary` | Обзор | новый; согласовать с `jobs.BacklogMetrics` |
| Workflow/эффекты lead-status | `workflow_runs`, `outbound_effects` | `GET …/lead-status/runs` | история на экране настроек | этап 3 |

## История

| Поле | Источник | Core admin read | Admin API | Статус |
| --- | --- | --- | --- | --- |
| Аудит Core по установке/интеграции | `audit_log` (`installation_id`, `object_type`, `object_id`, `actor_type`, `actor_id`, `action`, `metadata`, `correlation_job_id`, `created_at`) | `GET /admin/v1/audit?installation_id=&object_type=&object_id=` | вкладка История, карточка интеграции | новый; `metadata` уже без секретов (runbook integrations); `correlation_job_id` — ссылка на job |
| Аудит действий сотрудников | admin DB `admin_audit_log` | — | `GET /api/v1/system/audit` | новый |

## Система

| Поле | Источник | Core admin read | Admin API | Статус |
| --- | --- | --- | --- | --- |
| Доступность бекенда, версия, `observed_at` | `GET /admin/v1/backend` (Core: `buildinfo.Revision`, contract version, capabilities) | новый | `GET /api/v1/system/backends` | новый |
| Компоненты Activity/CRM Events (режим, readiness) | management `GET /components`, `GET /components/activity/ready` — другой listener | проксировать через `GET /admin/v1/backend` поле `components` | там же | новый; management порт наружу не открывать |
| Сотрудники, роли, статусы | admin DB `employees` | — | `GET/POST/PATCH /api/v1/system/employees` | новый |
| Сессии | admin DB `sessions` | — | `GET /api/v1/me/sessions`, `DELETE …/{id}` | новый |
| Каталог продуктов | конфигурация `deploy/backends.yaml` + `services.Components()` Core | `GET /admin/v1/backend` | `GET /api/v1/catalog` | новый |

## Правила заполнения

- «Статус» — `новый` (создать в этом этапе), `есть` (существующий endpoint),
  `этап N`, `отложено` (с причиной).
- Поле без строки в таблице не реализуется.
- Если источник — вычисление, указать формулу словами или SQL-агрегат.
- Для каждого показателя статистики этапа 3 добавляются столбцы «формула»,
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

## Этап 2: управление

| Поле | Источник |
| --- | --- |
| Операции, инициатор, команда, state/result | admin DB operations, через /operations/admin |
| Результат Core-команды | Core command receipt, без повторной отправки |
| authorization_check.classification/observed_at | Подтверждённый результат последней check-квитанции; внешний вызов worker |
| authorization_check.freshness | Admin: stale после 15 минут, unknown до результата |
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

## Этап 3: Activity, статистика, представления

Все агрегаты статистики — один snapshot на период (`24h`/`7d`/`30d`) с
одним `observed_at`. `null` и `0` различны. История подключений до
включения сбора не реконструируется: `connected`/`disconnected` только
по `audit_log` с момента появления Core admin.

| Поле | Формула | Период | Свежесть | Источник | Admin API |
| --- | --- | --- | --- | --- | --- |
| Подключения по продукту/состоянию | `COUNT(*)` snapshot `installations` × грант сервиса | текущий снимок | `observed_at` запроса | `GET /admin/v1/stats` | `GET /api/v1/stats` |
| Новые подключения | `COUNT(DISTINCT installation_id)` audit `installation.authorized` в окне | 24h/7d/30d | там же | там же `connected` | там же |
| Отключения | `COUNT(DISTINCT installation_id)` disable/uninstall/revoke в окне | 24h/7d/30d | там же | `disconnected` | там же |
| Активные аккаунты | distinct `account_id` с job или updated_at в окне | 24h/7d/30d | там же | `active_accounts` | там же |
| Последнее использование | `max(installations.updated_at, jobs.updated_at)` в окне; не `used_widget_tokens` | 24h/7d/30d | там же | `last_use_at` | там же |
| Ошибки задач | `COUNT` jobs failed/dead в окне | 24h/7d/30d | там же | `job_errors` | там же |
| Задержка p50 | percentile `job_attempts.duration_ms`; нет попыток → `null` | 24h/7d/30d | там же | `latency_p50_ms` | там же |
| Очереди | `jobs` GROUP BY type, status | текущий снимок | там же | `queues[]` | там же |
| Проблемы авторизации | установки `reauth_required` / auth missing | текущий снимок | там же | `auth_problems` | список `/stats/accounts?metric=` |
| Проблемы синхронизации | distinct installation из `activity_command_outbox.status='failed'` за 7 суток (Core-видимый сбой доставки, не полный CRM Events Status) | 7 суток | там же | `sync_problems` | там же |
| Сохранённые представления | admin DB `saved_views` | — | запись | — | `GET/POST/PATCH/DELETE /api/v1/views` |
| Grafana/Loki | env `GRAFANA_BASE_URL`/`LOKI_BASE_URL`; id только в query URL | интервал UI | конфиг процесса | — | поле `observability` в `/system/backends` |
