# Этап 2. Управление и восстановительные операции

**Цель:** выполнять основные действия поддержки из админки с подтверждённым
результатом.

**Зависимости от этапа 1:** listener и адаптер Core, сессии и RBAC, карточка
подключения, аудит админки.

## Объём

Сверка 2026-09-13: Core `88ce79f`, Admin `45d95c6`.
Ветки: `feature/admin-commands`, `feature/stage-2-operations`.
CLI provisioning по-прежнему использует `integrations.Store.Apply`;
для HTTP добавляется durable command receipt с idempotency и блокировкой
объекта. Check и внешний этап uninstall выполняются worker, не API.
Admin получает таблицу operations, журнал/карточку операции, команды
подключений/интеграций/доставок, серверную RBAC и восстановление результата
по ключу запроса без повторной отправки секретов. Pilot-команды включены
в этап 2; права существующей матрицы сохраняются.

## Части

### 2.1. Механизм операций (Admin API)

- Таблица `operations(id, employee_id, backend, target_type, target_id,
  command, idempotency_key, state, outcome, request_hash, result, error,
  created_at, updated_at, finished_at)`; уникальность
  `(employee_id?, backend, target, command, idempotency_key)` — ключ общий для
  всех сотрудников: повтор с другим payload → `conflict`.
- Состояния: `accepted → pending → running → succeeded | failed | partial |
  unknown_outcome` ([states.md](../design/states.md#операция-админки-этап-2)).
- Выполнение синхронно в пределах таймаута адаптера; при обрыве —
  `unknown_outcome` и рекомендация проверить объект. Core возвращает
  durable receipt; check и внешний этап uninstall исполняет worker.
- Перед выполнением — чтение текущего состояния объекта и проверка
  предусловия (например, `revoke` недопустим для `disabled`/`uninstalled`);
  проверка права по БД в момент выполнения.
- Аудит: инициатор, команда, объект, результат, безопасный список изменённых
  полей; в Core — `X-Admin-Actor`.
- Frontend: диалог с областью воздействия (интеграция ≠ установка), опрос
  состояния до завершения, история операций сохраняется после перезагрузки.

### 2.2. Команды Core (`amocrm-pro/internal/admincommand`)

HTTP-обработчики вызывают те же прикладные функции, что CLI. У
`internal/integrations.Store` **один** публичный метод —
`Apply(ctx, Command) (Result, error)`; команда выбирается строковым
`Command.Action`, валидируется `Command.Validate`, `Command.Actor` идёт в
аудит. `Result` содержит только `integration_id`, `installation_id`, `code`,
`status`, `action`, `webhook_error` — секретов нет.

| Команда | `Command.Action` | Заметки |
| --- | --- | --- |
| Создать интеграцию | `create` (`Code`, `ClientID`, `Secret`, `RedirectURI`, `WebhookEvents`, `Services`) | секрет — в теле запроса один раз, не логируется, в ответ не возвращается |
| Изменить параметры | `update` | только `RedirectURI`, `WebhookEvents` |
| Ротация секрета | `rotate-secret` (`Secret`) | сохранённый секрет не читается; отключённую интеграцию не включает |
| Включить/отключить интеграцию | `enable` / `disable` | |
| Грант сервиса | `set-service` (`Service`, `Enabled`) | только `enabled`, сервисы из `services.Known` (`lead-status`, `activity`) |
| Включить/отключить установку | `enable-installation` / `disable-installation` (`InstallationID`) | `enable-installation` только из `disabled` |
| Revoke | `revoke` | локальная инвалидация; показать шаг «повторная авторизация: ссылка OAuth start» |
| Uninstall | `uninstall` | частичный результат: статус зафиксирован, `Result.WebhookError` → `partial`; повтор идемпотентен |
| Reconcile webhook | нет прикладной функции — job `webhook.reconcile` ставит `oauth.Store.SaveInstallation`; для ручного запуска добавить функцию в `internal/webhook` (постановка через `jobs.Store.Enqueue`) | |
| Проверка подключения | новый прикладной сервис: `GET /account` через `amocrm.Client` с OAuth token provider **в worker/Gateway**, а не в API | классификация: `auth_error` (401/403), `network_error`, `rate_limited` (429 + Retry-After), `internal_error`; результат сохраняется как наблюдение с `observed_at` |
| Повтор доставки Activity | `activitybridge.RetryDelivery` | только моложе 7 суток |
| Pilot enable/disable | `activitybridge.SetPilot` | |

Проверка подключения выполняет внешний вызов — по правилам Core он должен идти
через владельца исходящего бюджета (worker/Gateway, ADR-0019). Вариант: job
`admin.connection_check` с результатом в `jobs.result` и опросом через
`GET /admin/v1/jobs/{id}`. Решение записать в ADR обоих репозиториев.

`audit_log.actor_type = 'admin'`, `actor_id` из `X-Admin-Actor`. Отдельного
пакета аудита в Core нет: `INSERT INTO audit_log` выполняется внутри
транзакций `integrations.Store.Apply`, `oauth.Store`, `webhook.Store`,
`activitybridge.SetPilot/RetryDelivery`. Новые команды admin используют тот же
приём — запись в той же транзакции, что изменение.

### 2.3. Повторы задач

Повторный запуск только для типов jobs с определённой безопасной семантикой
(список фиксируется в ADR после анализа обработчиков `internal/webhook`,
`leadstatus`, `jobs`). Прочие — только просмотр.

## Приёмка

- Оператор проверяет подключение и получает классифицированный результат с
  `observed_at`.
- Разрешённое восстановление выполняется без CLI и аудируется в обоих местах.
- Двойной клик/повтор запроса с тем же `Idempotency-Key` не создаёт второй
  внешний эффект (тест на уровне Admin API и на уровне Core).
- После перезагрузки операция доступна по `/operations/admin/{id}`.
- Обрыв соединения → `unknown_outcome`, не «ошибка команды».
- Конкурентные действия над одним объектом: второе получает `conflict` или
  корректно видит новое состояние.
- Ограничения ролей: `viewer` — 403, `operator` не может `uninstall`,
  `integrations:*`.
- Частичный сбой uninstall показан как `partial` с `webhook_error` и кнопкой
  «Повторить».

## Отчёт

Дата: 2026-09-13. Admin: коммит с этим отчётом в
`feature/stage-2-operations`. Core: `6f1a19c` в `feature/admin-commands`,
ветка создана от `feature/admin-read-api` (`88ce79f`).

### Реализованные экраны и операции

- Карточка подключения: проверка авторизации с классификацией и временем
  наблюдения; enable/disable, revoke, uninstall, reconcile, pilot.
- Интеграции: создание, параметры, ротация секрета, статус и гранты.
- Безопасный повтор webhook.reconcile/widget.ping и Activity delivery.
  Постановка в очередь подтверждается отдельно от результата задачи;
  карточка операции позволяет проследить выполнение задачи.
- Список и карточка операций: фильтры, курсор, сохранённый результат,
  опрос pending, восстановление после перезагрузки и потери POST-ответа.
- Серверные права, повторная проверка роли перед dispatch, предусловия,
  блокировка конкурирующих команд, общая идемпотентность и аудит.
- Partial uninstall требует нового подтверждения; unknown_outcome
  восстанавливается чтением квитанции, без слепого повторения эффекта.

### Изменения контрактов и миграции

- Admin API: команды подключений/интеграций/jobs/deliveries, список и
  карточка `/api/v1/operations/admin`, поиск по полному scope/request_key.
  Новые поля: authorization_check, retry_allowed, retry_reason.
- Core admin: `POST /admin/v1/commands`,
  `GET /admin/v1/commands/{id}` и политика повтора в job read model.
- Миграции: Admin `000004_operations`, Core `000016_admin_commands`.
  Миграции проверены в изолированных БД, не применялись к пилоту.
- Worker: обработка check/uninstall, фиксация результата и аудита под
  защитой lease/attempt; исходящие запросы используют общий бюджет.
  Существующие команды CLI и публичные маршруты сохраняются.
- Архитектура: Admin [ADR-0009](../adr/0009-durable-admin-operations.md),
  Core [ADR-0027](https://github.com/sk1fy/amocrm-pro/blob/dd2a4a5b3baa8d64ba678d2b6bf12005d24b1365/docs/adr/0027-admin-command-receipts.md).

### Результаты проверок

| Проверка | Репозиторий | Результат |
| --- | --- | --- |
| make check | Admin | ok |
| make e2e, собранный fixture-стек | Admin | 14 сценариев ok |
| Дополнительный сценарий queued → completed | Admin | 1 сценарий ok |
| lint, TypeScript, production build | Frontend | ok |
| Vitest | Frontend | 15 тестов ok |
| Повторные race/PG-проверки финального backend | Admin | ok |
| fmt-check, vet, test, openapi-check, integration-test | Core | ok |
| activity-ci | Core | ok, включая 25 тестов UI |

Проверены межпользовательская идемпотентность, конкурентный конфликт,
смена роли во время предусловий, атомарность аудита, потеря ответа,
восстановление lease и отсутствие сохранённого секрета. Core тестирует
реальный Worker.Run с HTTP-стабом amoCRM, классификацию ошибок, partial
uninstall, shared outbound budget и отсутствие повторного эффекта.

После отдельного дополнения UI отслеживанием queued-задачи выполнены
повторно lint/TypeScript/build, 6 целевых unit-тестов и новый e2e; полный
набор из 14 e2e после этого дополнения повторно не запускался.

Финальное уточнение Core: неизвестный исход OAuth refresh классифицируется
как internal_error, а не подтверждённый auth_error. После этой правки
пройдены отдельные vet/unit/race, а интеграционный и Activity-прогоны
использовали актуальные исходники через read-only mount.

### Инструкция запуска и демонстрационный сценарий

- [Локальный запуск](../runbooks/local-run.md).
- [Демонстрация этапа 2](../runbooks/demo-stage-2.md).
- Core [runbook команд](https://github.com/sk1fy/amocrm-pro/blob/dd2a4a5b3baa8d64ba678d2b6bf12005d24b1365/docs/runbooks/admin-commands.md).

### Происхождение данных демонстрации

- Fixture: браузерные сценарии используют помеченный адаптер fixture;
  проверяется реальная цепочка браузер → Admin API → PostgreSQL.
- Core: настоящие прикладные сервисы, SQL и worker на синтетических
  установках; внешние ответы amoCRM имитируются HTTP-сервером тестов.
- Live OAuth с настоящим тестовым аккаунтом не выполнялся.

### Ограничения и зависимости следующего этапа

- Для реальной проверки подключения нужны OAuth credentials и worker.
  Обновление API/worker требует применения обеих миграций.
- Доступные повторы ограничены явной политикой; произвольный job replay
  не предоставляется. Unknown outcome не является разрешением повтора.
- Управление панелями/модулями и статистика остаются этапом 3.
- Локальные пилотные и development-стеки не изменялись; развёртывание
  данного этапа в них не выполнялось.
