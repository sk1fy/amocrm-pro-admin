# Демонстрация этапа 1

Сценарий для команды: найти аккаунт, увидеть несколько виджетов с
разными состояниями, открыть подключение, убедиться в свежести и метке
fixture. Команд (изменений в Core) нет.

Два пути данных. Их нельзя смешивать без метки происхождения.

## Путь A. Fixture-адаптер (без пилотного Core)

Подходит, когда Docker VM полный или пилот `amocrm-pro` не запущен.
Admin API читает `kind: fixture` из `deploy/backends-e2e.yaml`.
Данные помечены `origin=fixture`. Это тот же набор аккаунтов, что в
SQL-fixture (`91000001`–`91000006`).

```sh
cd ../amocrm-pro-admin
make e2e
```

`make e2e` поднимает стек, создаёт
`admin@example.invalid` / `correct-horse-battery` и гоняет Playwright.
Стек e2e изолирован портами (`POSTGRES_PORT=5434`, `FRONTEND_PORT=5174`,
`HTTP_PORT=8094`, `MANAGEMENT_PORT=8095`) и не конфликтует с dev-стеком.
Для ручного просмотра того же стека:

```sh
POSTGRES_PORT=5434 FRONTEND_PORT=5174 HTTP_PORT=8094 MANAGEMENT_PORT=8095 \
  ADMIN_PUBLIC_ORIGIN='http://host.docker.internal:5174' \
  docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.e2e.yml \
  -p amocrm-pro-admin-e2e up --build --detach --wait
printf '%s' 'correct-horse-battery' | \
  POSTGRES_PORT=5434 FRONTEND_PORT=5174 HTTP_PORT=8094 MANAGEMENT_PORT=8095 \
  docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.e2e.yml \
  -p amocrm-pro-admin-e2e --profile tools run --rm -T admin-cli \
  employee create --email admin@example.invalid --name Admin --role admin \
  --password-stdin
```

Интерфейс: `http://127.0.0.1:5174`.

## Путь B. Пилотный Core + SQL-fixture

Реальный HTTP-путь Admin API → Core admin listener. Установки в Core
помечены `settings.origin = "fixture"`.

1. Поднять пилот (ветка `feature/admin-read-api` или слив с ней):

   ```sh
   cd ../amocrm-pro
   make activity-up
   curl --fail -H "Authorization: Bearer admin-dev-token-change-me" \
        -H 'X-Admin-Actor: employee:demo' \
        http://127.0.0.1:18083/admin/v1/backend
   ```

2. Создать интеграции через CLI (секреты только stdin), затем:

   ```sh
   cd ../amocrm-pro-admin
   make fixtures-core-dry-run
   make fixtures-core FIXTURES_CONFIRM=core-pilot
   ```

3. `cp .env.example .env` — `CORE_ADMIN_API_TOKEN` совпадает с
   `ADMIN_API_TOKEN` пилота. `make up`, создать сотрудника как в
   [local-run.md](local-run.md).

Если listener не отвечает, карточки Core показывают `unavailable`,
вход и раздел «Сотрудники» продолжают работать.

## Сценарий на экране

Учётная запись: `admin@example.invalid` и пароль, заданный в CLI.

1. Открыть `http://127.0.0.1:5173`. Без сессии прямой URL
   `/accounts/91000002` уводит на `/login?next=…`.
2. Войти. Оказаться на карточке `91000002` (`fixture-two.amocrm.test`).
3. Убедиться: два виджета, разные бейджи (`Нужна повторная
   авторизация` у `fixture-widget-a`, `Активно` у `fixture-widget-b`).
   Состояние одного не подменяет другое. Бейдж «тестовые данные».
4. Поиск на `/accounts` тремя строками (нормализация на сервере):
   - `91000002`
   - `fixture-two`
   - `https://fixture-two.amocrm.test/leads/detail/123`
5. Открыть подключение `fixture-widget-a`. Секции авторизации,
   webhook, грантов независимы. `observed_at` видно у блоков.
   Авторизация — `missing` + `unverified` (в SQL-fixture нет
   `oauth_credentials`). Синхронизация Activity — «нет данных»
   до этапа 3.
6. Обновить страницу: прямая ссылка открывается снова.
7. Вкладки Операции и История аккаунта, глобальные Виджеты /
   Операции / Система.

Ожидаемые аккаунты fixture:

| ID | Домен | Зачем |
| --- | --- | --- |
| 91000001 | fixture-one.amocrm.test | два активных виджета |
| 91000002 | fixture-two.amocrm.test | reauth vs active |
| 91000003 | fixture-three.amocrm.test | отключено оператором |
| 91000004 | fixture-four.kommo.test | удалено, Kommo |
| 91000005 | fixture-five.amocrm.test | OAuth не завершён |
| 91000006 | fixture-six.amocrm.test | ошибка и dead job |

## Что не показывать как успех этапа 1

- Команды enable/disable/revoke/uninstall — этап 2.
- Проверка токена запросом к amoCRM — этап 2.
- SyncStatus Activity — этап 3.
- Данные без метки fixture, если это SQL- или adapter-fixture.
