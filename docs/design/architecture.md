# Архитектура и размещение

Документ фиксирует, где живут части админки, как они общаются с бекендами и
какие границы нельзя нарушать. Обоснования — в [ADR-0001](../adr/0001-admin-api-placement.md),
[ADR-0002](../adr/0002-frontend-stack.md), [ADR-0003](../adr/0003-employee-sessions.md),
[ADR-0004](../adr/0004-observations-and-states.md).

## Топология

```text
 Браузер сотрудника
        |  HTTPS, cookie-сессия
        v
 +-------------------+        +------------------------------+
 | frontend (SPA)    |        | admin-api (Go)               |
 | React + Vite      | -----> | сессии, RBAC, аудит,         |
 | статика за nginx  |  /api  | агрегация аккаунтов,         |
 +-------------------+        | адаптеры бекендов            |
                              +------------------------------+
                                  |                |
                        admin PostgreSQL       service token, HTTP
                        (employees, sessions,      |
                         admin_audit_log)          v
                                       +------------------------------+
                                       | amocrm-pro `api`             |
                                       | admin listener               |
                                       | internal/adminread           |
                                       | internal/admincommand        |
                                       +------------------------------+
                                                 |
                                       Core PostgreSQL (владелец Core),
                                       Activity/CRM Events через
                                       существующие порты Core
```

Три уровня, у каждого своя ответственность:

| Уровень | Где | Отвечает за | Не делает |
| --- | --- | --- | --- |
| Frontend | `amocrm-pro-admin/frontend` | Экраны, URL-состояние, отображение состояний | Не хранит секреты, не вызывает бекенды напрямую |
| Admin API | `amocrm-pro-admin/backend` | Вход сотрудников, роли, аудит действий сотрудников, агрегация по бекендам, механизм операций | Не читает и не пишет таблицы Core/Activity/CRM Events напрямую |
| Core admin read/command | `amocrm-pro/internal/adminread`, `admincommand` | Чтение и команды Core через прикладные сервисы (`internal/integrations`, `internal/activitybridge`, `internal/jobs` …) | Не знает о сотрудниках админки, получает только actor-строку для аудита |

## Почему так

- **Границы владения (ADR-0010/0012 amocrm-pro).** Только владелец домена
  читает и меняет свои таблицы. Прямое подключение админки к Core
  PostgreSQL потребовало бы отдельной роли, связало бы админку со схемой
  Core и не покрыло бы команды через прикладные сервисы
  (`integrations.Store`, `activitybridge.SetPilot`, `RetryDelivery`).
- **Переиспользование логики.** Операторский CLI `cmd/integrations` уже вызывает
  `internal/integrations`. HTTP-обработчики Core admin вызывают те же функции.
  Запуск CLI через shell запрещён.
- **Расширяемость.** Admin API общается с любым бекендом через адаптер
  ([backend-adapter.md](backend-adapter.md)). Core — первый адаптер;
  fixture подтверждает контракт v1.
- **Частичная доступность.** Отказ Core admin listener или будущего бекенда даёт
  `unavailable` для его данных и не ломает вход, навигацию и остальные бекенды.

## Core admin в amocrm-pro

Поверхность уже в `amocrm-pro` (`internal/adminread`, `internal/admincommand`,
отдельный listener `cmd/api`). Проверки — Docker/Make того репозитория
(`make test`, `make openapi-check`, `make integration-test`). Новые
изменения — отдельная ветка по правилам Core, не `main` напрямую.

1. **Пакет `internal/adminread`.** Read-only обработчики и запросы.
   Запросы выбирают только безопасные колонки; `client_secret_ciphertext`,
   `*_token_ciphertext`, `webhook_key_*`, ключи шифрования этим пакетом
   не читаются. Каждый ответ содержит `observed_at` и `source: "core"`.
2. **Пакет `internal/admincommand`.** Команды вызывают
   `internal/integrations.Store` и `internal/activitybridge` так же, как
   CLI. Не копировать SQL мутаций в admin.
3. **Отдельный listener в `cmd/api`.** Конфигурация `ADMIN_HTTP_ADDRESS`
   и `ADMIN_API_TOKEN`. Если любая из переменных пуста — listener не
   поднимается (fail-closed). Адрес не должен совпадать с `HTTP_ADDRESS` и
   `MANAGEMENT_HTTP_ADDRESS`. Аутентификация: `Authorization: Bearer <token>`
   с постоянным по времени сравнением. Обязателен заголовок
   `X-Admin-Actor` (строка `employee:<uuid>` или `automation:<name>`),
   который Core пишет в `audit_log.actor_id` для команд; для чтения он
   попадает только в access log. Публикация порта — только
   `127.0.0.1` (`ACTIVITY_ADMIN_PORT`, по умолчанию `18083`).
4. **Маршруты.** Список `apicontract.AdminRoutes` отдельно от
   `apicontract.Routes`: тест `api/openapi_test.go` требует точного
   совпадения `openapi.yaml` с `Routes`, поэтому admin-маршруты в
   `Routes` добавлять нельзя.
5. **Контракт.** `api/admin-openapi.yaml` и тест
   `api/admin_openapi_test.go`. Обоснование listener —
   `docs/adr/0025-admin-read-listener.md` в Core.

## Admin API (этот репозиторий)

Отдельный Go-модуль `github.com/sk1fy/amocrm-pro-admin`,
собственная PostgreSQL 17.

Пакеты `backend/internal`:

| Пакет | Назначение |
| --- | --- |
| `platform/config` | Загрузка env, fail-closed для отсутствующих секретов |
| `platform/postgres` | pgx pool, таймауты |
| `platform/httpx` | JSON envelope, ошибки, request id, access log, recover |
| `auth` | Пароли (argon2id), сессии, cookie, CSRF-проверка |
| `rbac` | Роли, права, middleware `Require(permission)` |
| `employees` | Хранилище сотрудников, статусы, отзыв доступа |
| `audit` | Запись действий сотрудников в `admin_audit_log` |
| `adapter` | Контракт адаптера бекенда v1, типы `Observation`, ошибки |
| `adapter/core` | HTTP-клиент Core admin listener |
| `adapter/fixture` | Тестовый адаптер (`kind: fixture`) |
| `accounts` | Агрегация аккаунтов и подключений по адаптерам, частичная доступность |
| `catalog` | Каталог продуктов и бекендов из конфигурации |
| `operations` | Устойчивые операции сотрудников |
| `views` | Сохранённые представления списков |
| `httpapi` | Маршруты `/api/v1`, обработчики |

Конфигурация бекендов — файл `deploy/backends.yaml` (код, тип адаптера, base
URL, имя env-переменной с токеном, таймауты). Секреты только через env.

## Frontend

React + TypeScript + Vite, TanStack Router и TanStack Query, CSS Modules без
UI-кита ([ADR-0002](../adr/0002-frontend-stack.md)). Одностраничное приложение,
статика раздаётся nginx, `/api` проксируется в admin-api; cookie `SameSite=Strict`.

## Потоки

**Поиск аккаунта.** Frontend → `GET /api/v1/accounts?q=` → Admin API нормализует
запрос (ID, домен, ссылка) → параллельно опрашивает адаптеры с таймаутом →
объединяет по `account_id` → возвращает список и блок `sources` со статусом
каждого бекенда.

**Карточка подключения.** `GET /api/v1/connections/{backend}/{id}` → адаптер →
Core admin read `GET /admin/v1/installations/{id}` → ответ с `observed_at`,
статусами авторизации, webhook, грантов, последними jobs и аудитом.

**Команда.** `POST /api/v1/connections/{backend}/{id}/commands/{name}`
с `Idempotency-Key` → RBAC → запись операции в admin DB → адаптер → Core admin
command → результат/операция → аудит в admin DB и в Core `audit_log`.

## Безопасность

- Секреты (OAuth-токены, client secret, webhook key, service token) не покидают
  сервер; ответы содержат только факты наличия/сроков/версий.
- Admin listener Core слушает только внутреннюю сеть/loopback; публикация
  наружу запрещена.
- Cookie `HttpOnly; Secure; SameSite=Strict`; мутации требуют заголовок
  `X-Requested-With: admin-ui` и совпадение `Origin`.
- Все действия сотрудников аудируются с `employee_id`, `request_id`, действием,
  объектом и безопасным списком изменённых полей.
- Реальный IP клиента для лимита входа и аудита читается из `X-Real-IP`/
  `X-Forwarded-For` только при `TRUST_PROXY_HEADERS=true`
  ([ADR-0006](../adr/0006-trusted-proxy-headers.md)); без прокси доверие
  выключено.

## Целевой хост

Целевой хост запускает те же сервисы prod-оверлеем
[deploy/docker-compose.prod.yml](../../deploy/docker-compose.prod.yml)
поверх [deploy/docker-compose.yml](../../deploy/docker-compose.yml):
образы из registry, `APP_ENV=production`, обязательные
`ADMIN_PUBLIC_ORIGIN`, `CORE_ADMIN_API_TOKEN` и `ADMIN_DB_PASSWORD`,
порты только на loopback за TLS-прокси оператора. Реестр бекендов
заменяется хост-файлом (`BACKENDS_FILE_PATH`). Развёртывание, ротация
credentials, наблюдаемость и аварийные сценарии —
[runbooks/operator.md](../runbooks/operator.md).
