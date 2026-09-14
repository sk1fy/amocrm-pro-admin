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

Реестр бекендов (этап 4, `catalog.Registry.Probe`) сейчас выставляет
только `available`/`unavailable`/`unknown`; `degraded` остаётся
зарезервированным до появления soft-таймаута или частичных
подзапросов и в ответе не появляется
([ADR-0011](../adr/0011-adapter-contract-v1.md)).

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

Дополнительные факты: `credential_version` (колонка Core
`oauth_credentials.token_version`), `refreshed_at`, `expires_at`,
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

## Подписка аккаунта (этап 4)

Источник: адаптер `SubscriptionBackend.GetSubscription` (capability
`subscriptions`). Коммерческий факт аккаунта, отдельный от гранта
сервиса `Grant` ([ADR-0012](../adr/0012-subscriptions-source.md)).

| Канон | Из бекенда | Тон | Текст |
| --- | --- | --- | --- |
| `active` | `active` | `ok` | Активна |
| `trial` | `trial` | `attention` | Пробный период |
| `expired` | `expired` | `error` | Истекла |
| `cancelled` | `cancelled` | `off` | Отменена |

Правила:

- Неизвестное значение бекенда → `unknown` + `raw` (fixture 91000002
  отдаёт `grace_period`); unknown не означает «нет подписки».
- Пустой `items` при отсутствии способных бекендов или факта —
  «данные подписки недоступны» (`unknown`), никогда «нет подписки» и
  никогда не ошибка. Упавший бекенд виден как Observation/источник
  со свежестью `unavailable`.
- Показывать `plan`, состояние, `expires_at` (отсутствие — «—») и
  `capabilities`; `0` не подставляется вместо отсутствующих данных.
- Блок «Подписка» в карточке аккаунта независим от подключений:
  отказ источника не скрывает остальные факты аккаунта.

## Activity

Три независимых факта; объединять их в один статус запрещено.

**Pilot (Core, `activity_pilots.enabled`)**: `enabled` / `disabled` /
`not_configured` (строки нет). Тон `ok` / `off` / `unknown`.

**Доставка команд (Core, `activity_command_outbox.status`)**:

| Канон | Из Core | Тон | Текст |
| --- | --- | --- | --- |
| `pending_delivery` | `pending_delivery` | `attention` | Ожидает |
| `delivering` | `delivering` | `attention` | Выполняется |
| `accepted` | `accepted` | `ok` | Доставлена |
| `failed` | `failed` | `error` | Отклонена |
| `expired` | `expired` | `error` | Исчерпаны попытки |

Показывать вместе с `action` (`settings`/`sync`), `target`, `attempts`
как «N из M попыток», `error_code`, `created_at`, `updated_at`. Повтор —
только если `retry_allowed`; причина недоступности в подсказке, не
кнопкой на всю ширину. Команды старше 7 суток не повторяются
(ADR-0016 amocrm-pro).

**Синхронизация (владелец CRM Events, `SyncStatus`)**: `state`,
`verification`, `reauth_required`, `last_success_at`, `last_event_at`,
`lag_seconds`, `verified_from/through`, `error_code`. Сверено с
`serviceapi.SyncStatus` и ADR-0028 (Core `feature/admin-activity`).

| Канон | Тон | Когда |
| --- | --- | --- |
| `pending` | `attention` | Источник ещё не стабилизирован |
| `idle` | `ok` | Коллекция включена, сейчас не бежит.
  UI уточняет причину: нет новых событий / ожидает следующий
  запуск / источник недоступен |
| `running` | `attention` | Идёт sync/backfill |
| `disabled` | `off` | Выключено командой disable |
| `paused` | `attention` | Приостановлено источником |
| `failed` | `error` | Ошибка коллекции |
| `reauth_required` | `action` | Нужен повторный OAuth для синка |
| `not_enabled` | `off` | Источника нет / грант не выдан |
| `unknown` | `unknown` | Неизвестное значение или нет факта |

Unix-поля источника со значением 0 отдаются как `null` (`—`), лаг `0`
показывается как `0`. `unknown`, `partial`, `stale` и `not_enabled`
**нельзя** показывать как доказанное отсутствие активности.

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

## Сотрудник (admin DB)

Источник: admin DB `employees`. Роли и права — [roles.md](roles.md).
Роли показываются нейтральным текстом: `admin` → «Администратор»,
`operator` → «Оператор», `viewer` → «Наблюдатель».

| Канон | Из `employees.status` | Тон | Текст |
| --- | --- | --- | --- |
| `active` | `active` | `ok` | Активен |
| `disabled` | `disabled` | `off` | Отключён |

## Аккаунт (агрегат)

Аккаунт — `account_id` amoCRM. Агрегированное состояние вычисляется в Admin
API только для сортировки/фильтра и всегда показывается вместе с разбивкой по
подключениям. Первое совпадение сверху побеждает:

| Канон | Правило |
| --- | --- |
| `partial` | Хотя бы один участвующий бекенд `unavailable`, либо
  свежесть хотя бы одного подключения `unavailable`
  (подключения всё равно перечисляются) |
| `needs_action` | Хотя бы одно подключение `reauth_required` или авторизация
  `missing` при статусе `active`/`pending` |
| `error` | Хотя бы одно подключение `error` или webhook `error` |
| `attention` | Хотя бы одно `pending`/`authorizing`, либо
  `recent_failed_jobs > 0` (failed/dead за 24 ч), либо свежесть
  подключения `stale`, либо `authorization.unverified` на
  `active`/`pending` (факт из `AuthorizationDetails`, без
  подстановки, если деталей нет) |
| `inactive` | Все подключения `disabled`/`uninstalled` |
| `ok` | Все подключения `active`, свежие, без ошибок webhook,
  без missing/reauth и без `unverified` |
| `attention` | Любой остальной набор состояний |

Типы проблем для фильтра: `reauth_required`, `webhook_error`, `job_failures`,
`missing_credentials`, `disabled`, `source_unavailable`. Проблемы считаются
по фактам из списка аккаунтов (`webhook_status`, `authorization_state`,
`recent_failed_jobs`); при недоступном источнике выводится
`source_unavailable`, а счётчики «Требуют внимания» не показывают число
(«—»), пока источник не ответит.

## Итог подключения (карточка, UI)

Считается в frontend из Observation карточки, не заменяет
`installations.status` и не сортирует списки
([ADR-0015](../adr/0015-connection-diagnostics-ux.md)). Первое совпадение
сверху побеждает:

| Канон | Тон | Текст | Когда |
| --- | --- | --- | --- |
| `unavailable` | `error` | Недоступно | Observation установки `unavailable` |
| `needs_action` | `action` | Требует действия | `reauth_required`, нет credentials,
  `auth_error`, webhook `error`, установка `error`/`disabled` при
  ожидании включения, инцидент авторизации Core admin |
| `working_with_warnings` | `attention` | Работает с предупреждениями | Установка
  `active`, но проверка stale/unknown, 0 адресов webhook, failed jobs,
  sync idle с лагом, unverified |
| `working` | `ok` | Работает | `active`, локальная авторизация допустима,
  свежая проверка `verified_ok`, webhook не в ошибке |

Рядом 1–3 причины. Связанные `unavailable` Activity/панелей/сотрудников
с текстом `core admin authentication failed` — один инцидент, не три
независимых ошибки. Зависимые секции ссылаются на инцидент.

## Происхождение данных

| Метка | Когда |
| --- | --- |
| `real` | Данные реального бекенда |
| `fixture` | Тестовые данные (адаптер fixture или SQL-fixture с `settings.origin = "fixture"`) |

Метка `fixture` показывается бейджем на карточке и в списках; смешивать без
метки запрещено.

### Уточнения обработки неизвестных данных (2026-09-13)

- Отсутствие фактов credentials в summary не означает их отсутствия:
  неизвестные поля не подменяются `false`. До проверки к amoCRM признак
  `unverified` сохраняется и в карточке аккаунта.
- Раскрытые попытки задачи отображают `Observation`: `unavailable` —
  недоступный источник с повтором; только доступный пустой массив означает
  «Попыток нет».
- При смене/истечении сессии отменяются запросы прежнего сотрудника,
  очищается кеш. Ответ 403 не оставляет защищённые кешированные данные
  на экране сотрудников.

## Диагностика этапа 2: classification

Это результаты отдельного authorization_check, а не переименование
состояний credentials. На проводе используются следующие значения:

| Значение | Смысл | Тон |
| --- | --- | --- |
| verified_ok | Доступ к /account подтверждён worker | ok |
| auth_error | amoCRM отклонил авторизацию | action |
| network_error | Проверка не завершилась из-за сети | error |
| rate_limited | amoCRM ограничил запрос; retry_after при наличии | attention |
| internal_error | Внутренняя ошибка проверки | error |

Старые проектные названия verified_auth_error/verified_network_error
заменены классификацией выше в отдельном Observation. До результата —
unknown; старше 15 минут — stale. Отрицательный результат проверки может
иметь operation.state=succeeded: это завершённый процесс диагностики.

После unknown_outcome UI предлагает проверку объекта и историю, но не
слепой повтор. Partial uninstall допускает новую подтверждённую операцию
с новым ключом. Состояние оригинальной операции сохраняется.

Для reconcile и retry состояние `succeeded` с `outcome=queued` означает,
что Core подтвердил постановку задачи. Итог выполнения отслеживается
отдельно по `job_id`: карточка показывает «Задача поставлена в очередь»,
а «Проверить задачу» читает её Observation и опрашивает до завершения.

## Исход записи аудита

Источник: `admin_audit_log.outcome` и действие журнала. Тон задаёт
подсветку неуспешного входа и отклонённой операции.

| Канон | Когда | Тон | Текст |
| --- | --- | --- | --- |
| `ok` | `outcome=ok` | `ok` | Успех |
| `denied` | `outcome=denied` | `action` | Отклонено |
| `failed` | `outcome=failed` или `auth.login_failed` | `error` | Ошибка |
