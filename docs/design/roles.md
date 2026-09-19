# Роли и права

Три роли сотрудников. Право — атомарная строка `domain:action`; роль — набор
прав. Проверка выполняется на сервере (`rbac.Require`) для каждого маршрута;
frontend использует `GET /api/v1/me` только для скрытия недоступных действий.

## Роли

| Роль | Назначение |
| --- | --- |
| `viewer` | Наблюдатель: просмотр всего, кроме раздела сотрудников; без команд |
| `operator` | Поддержка: просмотр + диагностика и восстановительные команды |
| `admin` | Администратор: всё, включая управление интеграциями, сотрудниками и ролями |

## Матрица прав

| Право | viewer | operator | admin | С этапа |
| --- | :-: | :-: | :-: | --- |
| `accounts:read` | ✓ | ✓ | ✓ | этап 1 |
| `connections:read` | ✓ | ✓ | ✓ | этап 1 |
| `integrations:read` | ✓ | ✓ | ✓ | этап 1 |
| `operations:read` (jobs, попытки, история) | ✓ | ✓ | ✓ | этап 1 |
| `system:read` (бекенды, каталог, доступность) | ✓ | ✓ | ✓ | этап 1 |
| `audit:read` (аудит Core по объекту и аудит админки) | ✓ | ✓ | ✓ | этап 1 |
| `sessions:self` (свои сессии: список, отзыв) | ✓ | ✓ | ✓ | этап 1 |
| `employees:read` | — | — | ✓ | этап 1 |
| `employees:write` (создание, роль, блокировка, отзыв сессий) | — | — | ✓ | этап 1 |
| `connections:check` (проверка подключения к amoCRM) | — | ✓ | ✓ | этап 2 |
| `connections:enable`, `connections:disable` | — | ✓ | ✓ | этап 2 |
| `connections:revoke` | — | ✓ | ✓ | этап 2 |
| `connections:uninstall` | — | — | ✓ | этап 2 |
| `webhooks:reconcile` | — | ✓ | ✓ | этап 2 |
| `operations:retry` (повтор доставки/задачи с безопасной семантикой) | — | ✓ | ✓ | этап 2 |
| `integrations:write` (создание, параметры, сервисы) | — | — | ✓ | этап 2 |
| `integrations:rotate_secret` | — | — | ✓ | этап 2 |
| `integrations:enable`, `integrations:disable` | — | — | ✓ | этап 2 |
| `activity:settings:write`, `activity:sync`, `activity:panels:write` | — | ✓ | ✓ | этап 3 |
| `activity:pilot` | — | ✓ | ✓ | этап 2 |
| `leadstatus:rules:write` | — | ✓ | ✓ | этап 3 |
| `stats:read` | ✓ | ✓ | ✓ | этап 3 |
| `views:write` (личные представления; общие — только admin) | — | ✓ | ✓ | этап 3 |

Правила:

- Отключение всей интеграции (`integrations:disable`) и отключение одной
  установки (`connections:disable`) — разные права и разные диалоги.
- Команды требуют роли `operator`+, но конкретные команды могут проверять
  дополнительное условие текущего состояния объекта (например, `revoke` нельзя
  применить к `disabled`/`uninstalled` — это правило Core, Admin API его не
  дублирует, а показывает ошибку Core).
- Роль читается из БД на каждом запросе. Смена роли/блокировка отзывает все
  сессии сотрудника.
- Каждое действие с правом `*:write`, `*:check`, `*:retry`, `*:enable/disable`,
  `*:revoke`, `*:uninstall`, `*:rotate_secret`, `*:sync`, `*:pilot` — аудируется.
- Права этапа 3 (`activity:settings:write`, `activity:sync`,
  `activity:panels:write`, `leadstatus:rules:write`, `stats:read`,
  `views:write`) проверяются на сервере для маршрутов и команд. Frontend
  только скрывает недоступные кнопки.
- Общее представление (`shared=true`, `owner_employee_id` NULL) создаёт,
  изменяет и удаляет только `admin`. `operator` создаёт и меняет только
  личные представления; `viewer` не имеет `views:write`. Обход правила
  сервер отклоняет с `403`; frontend лишь скрывает флажок «Общее» и
  кнопку удаления общего представления.
- Чтение подписки (`GET /api/v1/accounts/{id}/subscription`)
  использует `accounts:read`; отдельного права нет. Бекенд без capability
  `subscriptions` даёт `unknown`, а не ошибку доступа.

## Actor в Core

Admin API передаёт в Core заголовок `X-Admin-Actor: employee:<employee_uuid>`.
Core записывает его в `audit_log.actor_id` с `actor_type = 'admin'` (новое
значение, отличное от `operator` CLI и `bootstrap`). Email и имя сотрудника в
Core не передаются; сопоставление — по UUID в admin DB.
