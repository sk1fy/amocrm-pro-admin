# Пользователи amoCRM в карточке аккаунта

## Объём

Сверено с Core `5a4ab71`. Пользователей amoCRM Core уже читает через
`amocrm.Client.CRMUsers` для справочников TeamOS (`crmreferences`, снимок
в памяти 5 минут) и распределения. Читает только worker — владелец
исходящего трафика amoCRM, OAuth-провайдера и бюджета (ADR-0019,
ADR-0029). Admin listener процесса `api` читает только PostgreSQL.
`installations.installed_by` есть в схеме, но Core его не заполняет
(`internal/oauth/store.go`). Контакты из формы установки виджета
(имя, телефон, роль) Core не хранит.

Часть добавляет вкладку «Пользователи» со списком ID, имени, активности
и признака администратора:

- Core, ветка `feature/admin-crm-users`: необязательный listener worker
  `ADMIN_CRM_HTTP_ADDRESS` (`:8085`, alias `core-admin-crm`),
  `GET /admin/v1/accounts/{account_id}/crm-users`, снимок в памяти
  5 минут, ADR-0042;
- Admin API: возможность `crm-users`, `crm_base_url`/`crm_timeout` в
  `backends.yaml`, `GET /api/v1/accounts/{account_id}/crm-users`,
  [ADR-0020](../adr/0020-account-crm-users.md);
- frontend: вкладка `/accounts/{id}/users` без polling.

Вне объёма: вкладка «Контакты» (нужен источник: `installed_by` или
сохранение контактов формы установки), вкладка «Установленные виджеты»
amoCRM, email и телефоны пользователей, группы и права, поиск и
пагинация по списку больше 1000 пользователей.

## Приёмка

- [x] Core читает пользователей только через worker с кэшем 5 минут;
  отказ amoCRM — состояние, а не ошибка listener.
- [x] Admin API отдаёт `{items, sources}`; без способного бекенда —
  пустые `items` и `sources`, отказ бекенда — источник `unavailable`.
- [x] `users: null` в любом состоянии, кроме `ok`; `[]` — аккаунт без
  пользователей.
- [x] Email, телефон, группы и права не выходят ни из Core, ни из
  Admin API; контракты OpenAPI запрещают лишние поля.
- [x] Вкладка не опрашивает Core и не обновляется по фокусу.
- [x] Unit, integration и e2e сценарии: список, лимит, нет подключения,
  недоступный источник.
- [x] `make check` (admin) и проверки Core зелёные.
- [x] data-sources, states, screens, admin-api, backend-adapter и ADR
  обновлены.

## Отчёт

Дата: 2026-11-06. Коммиты: amocrm-pro-admin `05ba26c`…`2df6903` и
документация в ветке `feature/account-crm-users`; amocrm-pro `e740bfc` в
ветке `feature/admin-crm-users`. В `main` не слиты.

### Реализованные экраны и операции

- Вкладка «Пользователи» карточки аккаунта (`/accounts/{id}/users`):
  состояние чтения, «Всего: N», срок снимка Core, ссылка на подключение,
  таблица ID / Имя / Статус / Администратор с сортировкой.
- В состояниях кроме `ok` — «Список пользователей неизвестен» с
  пояснением; `rate_limited` показывает срок повтора.
- Новых административных операций нет.

### Изменения контрактов и миграции

- Admin API: `GET /api/v1/accounts/{account_id}/crm-users`
  (`accounts:read`), возможность адаптера `crm-users`, ключи
  `crm_base_url`/`crm_timeout` в `backends.yaml`.
- Core admin: listener worker `ADMIN_CRM_HTTP_ADDRESS` и
  `GET /admin/v1/accounts/{account_id}/crm-users` в
  `api/admin-openapi.yaml`; пакет `internal/admincrm` добавлен в
  integration-прогон.
- Миграции admin DB: нет; Core: нет.

### Результаты проверок

| Команда | Репозиторий | Результат |
| --- | --- | --- |
| `make check` | amocrm-pro-admin | ok (docs, lint, race, 153 Vitest, integration, 44 Playwright, scripts, vulncheck) |
| `make test` / `openapi-check` / `integration-test` | amocrm-pro | ok |
| `go vet ./api/... ./cmd/... ./internal/...` | amocrm-pro | ok |

`make fmt-check` и `make vet` Core в рабочей копии падают на
игнорируемом локальном каталоге `tmp/`, которого нет в Git и Docker
context; Docker-цель `make test` выполняет gofmt и vet без него.
Разовый сбой `TestDistributionFailuresStayUnavailableOrUnknown`
(таймаут 5 мс при холодном старте) не повторился в пяти прогонах и в
`make check`.

### Инструкция запуска и демонстрационный сценарий

- [Локальный запуск](../runbooks/local-run.md); fixture-стек:
  `/accounts/91000001/users` — список из трёх пользователей,
  `/accounts/91000002/users` — лимит amoCRM, `/accounts/91000003/users`
  — нет авторизованного подключения.
- Core: раздел «Пользователи amoCRM» в `docs/runbooks/admin-read-api.md`
  репозитория `amocrm-pro`.

### Происхождение данных демонстрации

- Fixture: синтетические пользователи `Fixture User A/B/G` аккаунта
  91000001 и состояния 91000002/91000003, помечены `origin=fixture`.
- Real: живое чтение amoCRM через worker не проверялось.

### Ограничения и зависимости следующего этапа

- Нужны review, merge и выкладка обеих веток, Core первым. Без
  `crm_base_url` вкладка показывает «Данные о пользователях недоступны»;
  с `crm_base_url`, но без listener worker — «Источник недоступен».
  Остальные вкладки это не затрагивает.
- Вкладка «Контакты» требует источника: заполнения
  `installations.installed_by` или сохранения контактов формы установки.
- Email, телефоны, права пользователей и списки больше 1000 — отдельное
  решение.
