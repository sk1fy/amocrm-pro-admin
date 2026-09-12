# Словарь состояний

Единственный источник истины для канонических состояний и правил их показа.
Бекендные значения переводятся в канонические **в адаптере**; frontend знает
только этот словарь. Неизвестное бекендное значение → `unknown` с оригиналом в
поле `raw`. Проверенные значения Core взяты из `migrations/000001_init.up.sql`,
`000011_activity_delivery.up.sql`, `000014_core_redelivery_horizon.up.sql` и
`internal/serviceapi/contracts.go` репозитория `amocrm-pro`.

## Тона отображения

| Тон | Смысл | Цвет (CSS var) |
| --- | --- | --- |
| `ok` | Работает, действий не требуется | `--tone-ok` |
| `attention` | Работает с оговорками, стоит проверить | `--tone-attention` |
| `action` | Нужно действие сотрудника или клиента | `--tone-action` |
| `error` | Ошибка, требуется разбор | `--tone-error` |
| `off` | Выключено намеренно | `--tone-off` |
| `unknown` | Нет данных / данные не подтверждены | `--tone-unknown` |

Правила:

- `unknown` никогда не рисуется как `ok` и никогда не скрывается.
- Рядом с каждым состоянием, полученным от бекенда, доступно `observed_at`
  и источник (компонент `Observation`).
- Состояние одного подключения не влияет на состояние другого подключения
  того же аккаунта; агрегированное состояние аккаунта считается по правилам
  раздела «Аккаунт» и всегда сопровождается разбивкой.

## Наблюдение (freshness)

| Состояние | Когда | Показ |
| --- | --- | --- |
| `fresh` | Получено в этом запросе | Обычный вид, `observed_at` в подсказке |
| `stale` | Из кеша старше порога (этап 3+) | Метка «данные от HH:MM», тон `attention` |
| `unavailable` | Адаптер вернул ошибку/таймаут | «Источник недоступен», тон `error`, кнопка «Повторить» |
| `unknown` | Бекенд не отдаёт этот факт | «Нет данных», тон `unknown` |

## Бекенд (source availability)

| Состояние | Когда | Тон |
| --- | --- | --- |
| `available` | Ответил в срок | `ok` |
| `degraded` | Ответил, но часть подзапросов не удалась или превышен soft-таймаут | `attention` |
| `unavailable` | Ошибка соединения, 5xx, таймаут, неверный токен | `error` |
| `unknown` | Ещё не опрашивался | `unknown` |

## Интеграция (продукт/виджет)

Источник: `integrations.status` ∈ {`active`, `disabled`}.

| Канон | Из Core | Тон | Текст |
| --- | --- | --- | --- |
| `active` | `active` | `ok` | Активна |
| `disabled` | `disabled` | `off` | Отключена оператором |

Грант сервиса (`integration_services.enabled`): `granted` / `not_granted`
(тон `ok` / `off`). Сервисы каталога: `lead-status`, `activity`.

## Подключение (установка виджета в аккаунте)

Источник: `installations.status`.

| Канон | Из Core | Тон | Текст | Подсказка оператору |
| --- | --- | --- | --- | --- |
| `pending` | `pending` | `attention` | Ожидает авторизации | Клиент не завершил OAuth |
| `authorizing` | `authorizing` | `attention` | Авторизация выполняется | Промежуточное состояние OAuth callback |
| `active` | `active` | `ok` | Активно | — |
| `reauth_required` | `reauth_required` | `action` | Нужна повторная авторизация | Клиенту нужно заново пройти OAuth; локальные credentials не работают |
| `disabled` | `disabled` | `off` | Отключено оператором | Обратимо через enable-installation |
| `uninstalled` | `uninstalled` | `off` | Удалено | Восстанавливается только повторным OAuth |
| `error` | `error` | `error` | Ошибка установки | Смотреть последние jobs и аудит |

## Авторизация (OAuth credentials)

Вычисляется в Core admin read из `oauth_credentials` и `installations.status`.
Сами токены не читаются.

| Канон | Условие | Тон | Текст |
| --- | --- | --- | --- |
| `missing` | Нет строки `oauth_credentials` | `action` | Нет учётных данных |
| `reauth_required` | `installations.status = 'reauth_required'` | `action` | Требуется повторная авторизация |
| `refreshing` | `lease_until > now()` | `attention` | Обновление токена выполняется |
| `expired_refreshable` | `expires_at <= now()` и есть refresh token | `attention` | Access token истёк, обновится при следующем вызове |
| `valid` | `expires_at > now()` | `ok` | Действует до HH:MM |
| `unverified` | Любое из выше без внешней проверки | — | Модификатор: «не проверено запросом к amoCRM» |

До этапа 2 все состояния авторизации несут модификатор `unverified`: валидность
подтверждается только внешним вызовом. После этапа 2 проверка подключения даёт
`verified_ok`, `verified_auth_error`, `verified_network_error`,
`verified_rate_limited`, `verified_internal_error` с `observed_at` проверки.

Дополнительные факты: `token_version`, `refreshed_at`, `expires_at`,
`key_version` (только номер версии ключа).

## Webhook-подписка

Источник: `installations.webhook_status`, `webhook_last_error`,
`webhook_checked_at`.

| Канон | Из Core | Тон | Текст |
| --- | --- | --- | --- |
| `pending` | `pending` | `attention` | Ожидает регистрации (reconcile) |
| `active` | `active` | `ok` | Зарегистрирована |
| `disabled` | `disabled` | `off` | Отключена |
| `unregistered` | `unregistered` | `off` | Снята (uninstall) |
| `error` | `error` | `error` | Ошибка регистрации |

Показывать `webhook_last_error` (усечённый, без URL с ключами) и
`webhook_checked_at`. Список подписанных событий — `webhook_settings`.

## Activity

Три независимых факта; объединять их в один статус запрещено.

**Pilot (Core, `activity_pilots.enabled`)**: `enabled` / `disabled` /
`not_configured` (строки нет). Тон `ok` / `off` / `unknown`.

**Доставка команд (Core, `activity_command_outbox.status`)**:

| Канон | Из Core | Тон |
| --- | --- | --- |
| `pending_delivery` | `pending_delivery` | `attention` |
| `delivering` | `delivering` | `attention` |
| `accepted` | `accepted` | `ok` |
| `failed` | `failed` | `error` |
| `expired` | `expired` | `error` |

Показывать вместе с `action` (`settings`/`sync`), `target`, `attempts`,
`error_code`, `created_at`. Команды старше 7 суток не повторяются (ADR-0016
amocrm-pro).

**Синхронизация (владелец CRM Events, `SyncStatus`)**: `state`,
`verification`, `reauth_required`, `last_success_at`, `last_event_at`,
`lag_seconds`, `verified_from/through`, `error_code`. Значения `state`
источника (`event_sources.state`, без SQL CHECK, из кода CRM Events):
`pending`, `idle`, `running`, `disabled`, `paused`, `failed`,
`reauth_required`; при реализации этапа 3 сверить с актуальным кодом. На
этапе 1 этот факт отдаётся как `unknown` с причиной «источник подключается на
этапе 3». Правило
из runbook Activity: `unknown`, `partial` и `stale` **нельзя** показывать как
доказанное отсутствие активности.

## Job (Core queue)

Источник: `jobs.status`; попытки — `job_attempts.outcome`.

| Канон | Из Core | Тон |
| --- | --- | --- |
| `queued` | `queued` | `attention` |
| `processing` | `processing` | `attention` |
| `retry` | `retry` | `attention` |
| `completed` | `completed` | `ok` |
| `failed` | `failed` | `error` |
| `dead` | `dead` | `error` |
| `cancelled` | `cancelled` | `off` |

Outcome попытки: `completed`, `retry`, `failed`, `dead`, `cancelled`,
`lease_expired` (тон `error`). Показывать `type`, `attempts/max_attempts`,
`run_after`, `last_error_code`, `last_error_message` (усечённый), `finished_at`.
`payload` и `result` в интерфейс не выводятся до отдельного решения о редакции.

## Операция админки (этап 2)

`accepted` → `pending` → `running` → `succeeded` | `failed` | `partial` |
`unknown_outcome`. Тон: `attention` для первых трёх, `ok`, `error`, `attention`,
`unknown`. `unknown_outcome` — обрыв соединения при выполнении; интерфейс
предлагает «Проверить состояние», а не сообщает об ошибке команды.

## Аккаунт (агрегат)

Аккаунт — `account_id` amoCRM. Агрегированное состояние вычисляется в Admin
API только для сортировки/фильтра и всегда показывается вместе с разбивкой по
подключениям:

| Канон | Правило |
| --- | --- |
| `needs_action` | Хотя бы одно подключение `reauth_required` или авторизация `missing` при статусе `active`/`pending` |
| `error` | Хотя бы одно подключение `error` или webhook `error` |
| `attention` | Хотя бы одно `pending`/`authorizing`, либо есть `dead`/`failed` jobs за 24 ч |
| `ok` | Все подключения `active` без проблем |
| `inactive` | Все подключения `disabled`/`uninstalled` |
| `partial` | Часть источников `unavailable` — агрегат не вычислен полностью |

Типы проблем для фильтра: `reauth_required`, `webhook_error`, `job_failures`,
`missing_credentials`, `disabled`, `source_unavailable`.

## Происхождение данных

| Метка | Когда |
| --- | --- |
| `real` | Данные реального бекенда |
| `fixture` | Тестовые данные (адаптер fixture или SQL-fixture с `settings.origin = "fixture"`) |

Метка `fixture` показывается бейджем на карточке и в списках; смешивать без
метки запрещено.
