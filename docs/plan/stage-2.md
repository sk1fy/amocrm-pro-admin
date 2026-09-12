# Этап 2. Управление и восстановительные операции

**Цель:** выполнять основные действия поддержки из админки с подтверждённым
результатом.

**Зависимости от этапа 1:** listener и адаптер Core, сессии и RBAC, карточка
подключения, аудит админки.

## Объём

Заполняется агентом перед началом: коммит `amocrm-pro`, сверка команд CLI
`cmd/integrations` и `cmd/activity-control` с текущим кодом (набор команд и их
семантика могут измениться), расхождения с [roles.md](../design/roles.md).

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
  `unknown_outcome` и рекомендация проверить объект. Фоновые операции — только
  если бекенд сам возвращает идентификатор операции (Activity).
- Перед выполнением — чтение текущего состояния объекта и проверка
  предусловия (например, `revoke` недопустим для `disabled`/`uninstalled`);
  проверка права по БД в момент выполнения.
- Аудит: инициатор, команда, объект, результат, безопасный список изменённых
  полей; в Core — `X-Admin-Actor`.
- Frontend: диалог с областью воздействия (интеграция ≠ установка), опрос
  состояния до завершения, история операций сохраняется после перезагрузки.

### 2.2. Команды Core (`amocrm-pro/internal/admincommand`)

HTTP-обработчики вызывают те же прикладные функции, что CLI:

| Команда | Прикладной вызов (проверить при старте) | Заметки |
| --- | --- | --- |
| Создать интеграцию | `integrations.Store.Create` | секрет — в теле запроса один раз, не логируется, в ответ не возвращается |
| Изменить параметры | `Store.Update` | только `redirect_uri`, `webhook_events` |
| Ротация секрета | `Store.RotateSecret` | сохранённый секрет не читается |
| Включить/отключить интеграцию | `Store.Enable/Disable` | |
| Грант сервиса | `Store.SetService` | только `enabled` |
| Включить/отключить установку | `Store.EnableInstallation/DisableInstallation` | |
| Revoke | `Store.Revoke` | локальная инвалидация; показать шаг «повторная авторизация: ссылка OAuth start» |
| Uninstall | `Store.Uninstall` | частичный результат: статус зафиксирован, `webhook_error` → `partial`; повтор идемпотентен |
| Reconcile webhook | постановка job `webhook.reconcile` через `jobs.Store` — проверить существующий способ | |
| Проверка подключения | новый прикладной сервис: `GET /account` через `amocrm.Client` с OAuth token provider **в worker/Gateway**, а не в API | классификация: `auth_error` (401/403), `network_error`, `rate_limited` (429 + Retry-After), `internal_error`; результат сохраняется как наблюдение с `observed_at` |
| Повтор доставки Activity | `activitybridge.RetryDelivery` | только моложе 7 суток |
| Pilot enable/disable | `activitybridge.SetPilot` | |

Проверка подключения выполняет внешний вызов — по правилам Core он должен идти
через владельца исходящего бюджета (worker/Gateway, ADR-0019). Вариант: job
`admin.connection_check` с результатом в `jobs.result` и опросом через
`GET /admin/v1/jobs/{id}`. Решение записать в ADR обоих репозиториев.

`audit_log.actor_type = 'admin'`, `actor_id` из `X-Admin-Actor`.

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
