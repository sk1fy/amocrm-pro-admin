# Инструкция оператора

Эксплуатация админки на целевом хосте: роли и доступ, развёртывание
prod-оверлея, ротация credentials, наблюдаемость, retention, backup и
аварийные сценарии. Локальный стек и e2e — [local-run.md](local-run.md).
Сквозной сценарий экранов — [demo-stage-4.md](demo-stage-4.md).
Подключение нового модуля — [new-module.md](new-module.md).

Команды выполняются из checkout репозитория на хосте, например
`/opt/amocrm-pro-admin`. Все секреты — в env-файле хоста
`/etc/amocrm-admin/admin.env` (права `0600`), не в git и не в командах.

## 1. Роли, доступ и аудит

Роли и права — [roles.md](../design/roles.md):

- `viewer` — наблюдение: аккаунты, подключения, операции, статистика;
- `operator` — плюс диагностика и восстановительные команды;
- `admin` — плюс сотрудники, роли, интеграции, удаление установок.

Права проверяются на сервере при каждом запросе; интерфейс лишь скрывает
недоступное. Смена роли, блокировка и отзыв сессий выполняются в разделе
«Сотрудники» (роль `admin`) или через `admin-cli`, оба пути аудируются.

```sh
dc --profile tools run --rm admin-cli employee disable \
  --email user@example.com
dc --profile tools run --rm admin-cli employee set-role \
  --email user@example.com --role operator
dc --profile tools run --rm admin-cli employee revoke-sessions \
  --email user@example.com
```

`disable` и `set-role` отзывают все сессии сотрудника; `revoke-sessions`
только инвалидирует их. Каждое действие пишется в `admin_audit_log`
(admin DB, 365 суток) и видно в интерфейсе; команды в Core уходят с
`X-Admin-Actor: employee:<uuid>`. Аудит не удаляется вместе с
сотрудником.

## 2. Подготовка хоста

- DNS `admin.example.com` указывает на хост; сертификат выпущен на
  операторском reverse proxy (Let's Encrypt или корпоративный CA).
- Reverse proxy terminates TLS и маршрутизирует:
  - `https://admin.example.com/` → `127.0.0.1:5173` (frontend, SPA);
  - `https://admin.example.com/api/` → `127.0.0.1:8090` (admin-api).
  Proxy передаёт `X-Forwarded-For`/`X-Real-IP`; `TRUST_PROXY_HEADERS=true`
  ([ADR-0006](../adr/0006-trusted-proxy-headers.md)). Оба порта
  публикуются только на loopback: management listener `:8092` и
  PostgreSQL наружу не выходят.
- Docker Engine и Compose с поддержкой `!reset`/`!override` (v2.24+ или
  standalone `docker-compose`). Дальше примеры для `docker-compose`;
  при plugin-версии задайте `DC="docker compose"`.
- Checkout репозитория, env-файл, постоянный диск под volume
  `admin-postgres-data` и каталог бэкапов, например
  `/var/backups/amocrm-admin`.
- Core admin listener доступен из контейнера admin-api (адрес — в
  `backends.yaml`, см. ниже).

```sh
cd /opt/amocrm-pro-admin
ENV_FILE=/etc/amocrm-admin/admin.env
FILES="-f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml"
DC=${DC:-docker-compose}
dc() { $DC -p amocrm-admin --env-file "$ENV_FILE" $FILES "$@"; }
```

`-p amocrm-admin` фиксирует имена проекта, сети (`amocrm-admin_admin`) и
volume. Не меняйте его между запусками.

## 3. Сборка и публикация образов

Публикуйте образы с release-машины; на целевой хост они только
загружаются. `backend/Dockerfile` собирает три образа из разных target,
`frontend/Dockerfile` — статику за nginx. `make build` собирает только
локальный dev-стек, для публикации используйте `docker build`:

```sh
cd /opt/amocrm-pro-admin/backend
REV=$(git rev-parse --short HEAD)
docker build --target admin-api --build-arg BUILD_REVISION="$REV" \
  -t registry.example.com/amocrm-admin-api:2026.09.13 .
docker build --target migrate --build-arg BUILD_REVISION="$REV" \
  -t registry.example.com/amocrm-admin-migrate:2026.09.13 .
docker build --target admin-cli --build-arg BUILD_REVISION="$REV" \
  -t registry.example.com/amocrm-admin-cli:2026.09.13 .
cd ../frontend
docker build -t registry.example.com/amocrm-admin-frontend:2026.09.13 .
docker push registry.example.com/amocrm-admin-api:2026.09.13
# …то же для migrate, cli, frontend
```

Теги — неизменяемые (дата/SHA), `latest` не использовать. Ревизия
попадает в label `org.opencontainers.image.revision`.

## 4. `backends.yaml` на хосте

`deploy/backends.yaml` — шаблон без секретов: бекенд указывает
`token_env` (имя переменной), а не токен. Скопируйте его на хост,
поправьте `base_url` бекенда `core` на адрес admin listener Core,
доступный из контейнера (`host.docker.internal:18083` — если Core на
том же хосте), и удалите блок `fixture`: тестовый адаптер в проде
показывал бы синтетические данные. Путь задаётся в env:

```sh
BACKENDS_FILE_PATH=/etc/amocrm-admin/backends.yaml
```

Файл монтируется read-only в `/etc/admin/backends.yaml`. Контракт —
[backend-adapter.md](../design/backend-adapter.md).

## 5. Переменные окружения

```sh
# /etc/amocrm-admin/admin.env (0600), значения — из хранилища секретов
ADMIN_API_IMAGE=registry.example.com/amocrm-admin-api:2026.09.13
ADMIN_FRONTEND_IMAGE=registry.example.com/amocrm-admin-frontend:2026.09.13
MIGRATE_IMAGE=registry.example.com/amocrm-admin-migrate:2026.09.13
ADMIN_CLI_IMAGE=registry.example.com/amocrm-admin-cli:2026.09.13
ADMIN_DB_PASSWORD=<сгенерированный пароль>
ADMIN_PUBLIC_ORIGIN=https://admin.example.com
CORE_ADMIN_API_TOKEN=<токен admin listener Core>
BACKENDS_FILE_PATH=/etc/amocrm-admin/backends.yaml
```

`ADMIN_PUBLIC_ORIGIN` — точный origin браузера (схема и хост, без
завершающего `/`): по нему проверяется `Origin` мутаций.
`ADMIN_API_IMAGE`, `ADMIN_FRONTEND_IMAGE`, `ADMIN_DB_PASSWORD`,
`ADMIN_PUBLIC_ORIGIN`, `CORE_ADMIN_API_TOKEN` обязательны: без них
Compose не стартует, dev-значений по умолчанию нет. Если
`MIGRATE_IMAGE`/`ADMIN_CLI_IMAGE` не заданы, Compose ожидает локальные
теги `amocrm-admin-migrate:local`/`amocrm-admin-cli:local`.

## 6. Первый запуск

```sh
dc config --quiet          # синтаксис и обязательные переменные
dc pull
dc up --detach --wait
dc ps                      # health: healthy у postgres, api, frontend
```

Первый администратор (пароль только через stdin, из хранилища секретов):

```sh
printf '%s' "$ADMIN_BOOTSTRAP_PASSWORD" | \
  dc --profile tools run --rm -T admin-cli employee create \
  --email admin@example.com --name Admin --role admin --password-stdin
```

Вход: `https://admin.example.com`, созданный email.

## 7. Миграции

admin-api при старте проверяет актуальность схемы (`EnsureCurrent`) и
падает, если есть непримененные миграции. Перед любыми миграциями
сделайте backup (раздел 13). Применение:

```sh
dc run --rm migrate up
```

Через `make` (базовый файл передаётся внутри `COMPOSE`, потому что
`COMPOSE_FILE` принимает один путь):

```sh
make migrate \
  COMPOSE="docker-compose -p amocrm-admin \
    --env-file /etc/amocrm-admin/admin.env \
    -f deploy/docker-compose.yml" \
  COMPOSE_FILE=deploy/docker-compose.prod.yml
```

`migrate down` выполняется только осознанно и требует
`MIGRATION_DOWN_CONFIRM=revert-all-migrations`; на общих данных
запрещено (раздел 16 стайл-гайда).

## 8. Проверки здоровья

Management listener не публикуется, проверки — изнутри контейнера:

```sh
dc exec -T admin-api wget -qO- http://127.0.0.1:8092/live
dc exec -T admin-api wget -qO- http://127.0.0.1:8092/ready
```

`/live` отвечает `{"status":"ok"}`; `/ready` пингует admin DB и при
недоступности отдаёт 503. Снаружи проверяйте proxy:

```sh
curl --fail --silent --show-error --head https://admin.example.com/
```

## 9. Дымовой сценарий

1. Войти под администратором, проверить `/ready` (раздел 8).
2. Найти аккаунт по домену или ID; карточка показывает подключения с
   источником `core` и `observed_at`.
3. Открыть подключение: статусы авторизации, webhook, jobs, аудит.
4. «Система»: бекенд `core` — `available`, ревизия и контракт бекенда.
5. Проверить, что вход и действие попали в аудит.

Полные сценарии — [demo-stage-1.md](demo-stage-1.md),
[demo-stage-2.md](demo-stage-2.md), [demo-stage-3.md](demo-stage-3.md).

## 10. Ротация credentials

### `CORE_ADMIN_API_TOKEN`

1. Сгенерировать новый токен (например, `openssl rand -hex 32`),
   сохранить в хранилище секретов.
2. В репозитории `amocrm-pro` обновить `ADMIN_API_TOKEN` и перезапустить
   `api` (`docker compose -f docker-compose.activity.yml up -d api`).
3. В `/etc/amocrm-admin/admin.env` обновить `CORE_ADMIN_API_TOKEN`.
4. Пересоздать admin-api, чтобы он прочитал env:
   `dc up --detach admin-api` (перезапуск без пересоздания env не
   подхватывает).
5. Проверить: `/ready` отвечает 200, затем войти и открыть «Систему»
   или запросить `GET /api/v1/system/backends` с сессией; бекенд `core`
   должен быть `available` со свежим `observed_at`.

Порядок важен: сначала Core, потом admin. Пока токены не совпали, `core`
показывается как `unavailable` (кратковременное окно), остальные данные
и вход не страдают. Сессии сотрудников не отзываются.

### Пароль admin DB (`ADMIN_DB_PASSWORD`)

Нужно короткое окно обслуживания: пароль в БД и пароль в env меняются
по очереди.

1. Сгенерировать пароль и сохранить в хранилище секретов.
2. Войти в psql внутри контейнера и сменить пароль без эха
   (команда `\password` не печатает и не хранит его в истории):
   `dc exec admin-postgres psql -U admin -d postgres`, далее
   `\password admin`.
3. Обновить `ADMIN_DB_PASSWORD` в `/etc/amocrm-admin/admin.env`.
4. Пересоздать postgres и admin-api, чтобы env совпал с БД:
   `dc up --detach --force-recreate admin-postgres admin-api`.
   Пересоздание postgres не трогает volume с данными; это важно и для
   `restore-check`, который читает `POSTGRES_PASSWORD` из контейнера.
5. Проверить `/ready` и вход. Повторить для `migrate`/`admin-cli` не
   нужно — они берут env при каждом запуске.

### Что означает «cookie secret»

В этом проекте подписи cookie нет и соответствующего секрета не
существует. Проверка по коду:

- `config.LoadAPI`
  ([config.go](../../backend/internal/platform/config/config.go))
  не читает cookie/session secret; из конфигурации берётся только
  `CookieSecure`, производный от `APP_ENV=production`.
- Сессия — 32 случайных байта (`auth.NewToken`), в
  `sessions.token_hash` хранится только SHA-256
  ([token.go](../../backend/internal/auth/token.go)); cookie
  `HttpOnly; Secure; SameSite=Strict` несёт непрозрачный токен
  ([sessions.go](../../backend/internal/auth/sessions.go)).

Поэтому ротация «cookie secret» = инвалидация всех сессий плюс смена
пароля admin DB:

1. Отозвать сессии у каждого активного сотрудника (каждый вызов
   аудируется):

   ```sh
   dc exec -T admin-postgres psql -U admin -d admin -tAc \
     "SELECT email FROM employees WHERE status='active'" |
   while read -r email; do
     dc --profile tools run --rm -T admin-cli \
       employee revoke-sessions --email "$email"
   done
   ```

2. Сменить `ADMIN_DB_PASSWORD` (процедура выше).

Существующие cookie после этого перестают находить сессию, все
сотрудники входят заново. Пароль БД закрывает доступ к хешам сессий.

## 11. Наблюдаемость

Метрики — `/metrics` на management listener `:8092`, без
аутентификации, доступ только из внутренней сети
([ADR-0013](../adr/0013-admin-metrics.md)). Prometheus оператора
подключается к сети Compose:

```sh
docker network connect amocrm-admin_admin <prometheus-container>
```

Задача scrape: target `admin-api:8092` (или IP контейнера), job
`admin-api`. Labels конечны: `route`, `method`, `status`, `backend`,
`outcome`; UUID, email, домены и request id в labels запрещены.
`backend` — код из `backends.yaml`.

На что алертить (словами):

- `admin_backend_up{backend="core"} == 0` дольше 5 минут — бекенд
  недоступен; админка работает частично.
- `up{job="admin-api"} == 0` или `/ready` не 200 — admin-api или его
  БД недоступны.
- Доля 5xx: `rate(admin_http_requests_total{status=~"5.."}[5m])`
  относительно всех запросов (порог, например, 2% за 15 минут).
- `time() - admin_backend_last_response_timestamp_seconds > 900` —
  давно нет успешного ответа бекенда.
- Рост `admin_http_request_duration_seconds` выше привычного p95.

Ссылки Grafana/Loki задаются на admin-api (`GRAFANA_BASE_URL`,
`LOKI_BASE_URL`) и показываются на экране «Система». Логи контейнеров —
json-file с ротацией; для поиска по логам отправляйте их в Loki
оператора (агент на хосте).

## 12. Retention и prune

Политика хранения — [ADR-0014](../adr/0014-admin-db-retention.md):
аудит 365 суток, терминальные операции 180, истёкшие/отозванные сессии
30. Удаляет только `admin-cli prune`, всегда сначала dry-run, затем тот
же вызов с `--confirm`:

```sh
dc --profile tools run --rm -T admin-cli prune \
  --audit-before "$(date -u -d '365 days ago' +%F)" \
  --operations-before "$(date -u -d '180 days ago' +%F)" \
  --sessions-before "$(date -u -d '30 days ago' +%F)"
```

Проверить счетчики dry-run и выполнить удаление:

```sh
dc --profile tools run --rm -T admin-cli prune \
  --audit-before "$(date -u -d '365 days ago' +%F)" \
  --operations-before "$(date -u -d '180 days ago' +%F)" \
  --sessions-before "$(date -u -d '30 days ago' +%F)" --confirm
```

Рекомендуемое расписание — раз в сутки ночью (03:30 UTC) из cron;
оберните обе команды в скрипт `/usr/local/bin/amocrm-admin-prune`
(вне репозитория) и добавьте:

```cron
30 3 * * * /usr/local/bin/amocrm-admin-prune >>/var/log/admin-prune.log 2>&1
```

Ненулевой код возврата cron обязан алертить. Незавершённые операции не
удаляются никогда.

## 13. Резервное копирование

Бэкап — `pg_dump --format=custom`; цели `make backup-db` и
`make restore-check` работают из checkout, им можно передать prod-файлы
(как в разделе 7). Бэкап:

Для приёмочной проверки с точным сравнением числа строк остановите
`admin-api` и другие writers до `backup-db` и не запускайте их до окончания
`restore-check`. Сам `pg_dump` даёт согласованный snapshot и без остановки,
но сравнение восстановленного snapshot с уже изменившейся live-БД не имеет
смысла. Плановый online backup разрешён; точную сверку выполнять в отдельном
окне без записей.

```sh
make backup-db BACKUP_DIR=/var/backups/amocrm-admin \
  COMPOSE="docker-compose -p amocrm-admin \
    --env-file /etc/amocrm-admin/admin.env \
    -f deploy/docker-compose.yml" \
  COMPOSE_FILE=deploy/docker-compose.prod.yml
```

Эквивалент без make (тот же `pg_dump` внутри контейнера):

```sh
dc exec -T admin-postgres pg_dump --format=custom --no-owner \
  --no-privileges --username=admin --dbname=admin \
  > /var/backups/amocrm-admin/admin-$(date -u +%Y%m%d-%H%M%S).dump
```

Проверка restore в черновую БД (живая база только читается, черновая
удаляется на выходе):

```sh
make restore-check RESTORE_CONFIRM=restore-check \
  BACKUP_FILE=/var/backups/amocrm-admin/admin-20260913-033000.dump \
  COMPOSE="docker-compose -p amocrm-admin \
    --env-file /etc/amocrm-admin/admin.env \
    -f deploy/docker-compose.yml" \
  COMPOSE_FILE=deploy/docker-compose.prod.yml
```

После успешной проверки и автоматического удаления scratch DB снова запустите
`admin-api` и проверьте `/ready`.

Расписание: бэкап ежедневно, копия дампов на другой хост/в объектное
хранилище; учебный restore — раз в месяц, после ротации пароля БД и
перед миграциями. Хранить не меньше 30 ежедневных и 12 месячных дампов.

## 14. Аварийные сценарии

**admin-api недоступен.** `dc ps`, затем `dc logs --tail=200 admin-api`
и `dc exec -T admin-api wget -qO- http://127.0.0.1:8092/ready`. Частые
причины: непримененная миграция (`dc run --rm migrate up`), рассинхрон
`ADMIN_DB_PASSWORD` с БД (раздел 10), занятый порт 8090, невалидный env
(ошибка конфигурации в логах). Поднять: `dc up --detach admin-api`.

**Один бекенд недоступен.** Частичная доступность: его данные —
`unavailable`, вход и остальные бекенды работают. Проверить
`admin_backend_up{backend="core"}`, состояние admin listener Core и
совпадение токена (после ротации — раздел 10). Ошибка в интерфейсе
показывает источник, повторять команды не нужно до восстановления.

**Рост диска admin DB.** Проверить размеры таблиц:

```sh
dc exec -T admin-postgres psql -U admin -d admin <<'SQL'
SELECT pg_size_pretty(pg_total_relation_size('admin_audit_log')),
       pg_size_pretty(pg_total_relation_size('operations')),
       pg_size_pretty(pg_total_relation_size('sessions'));
SQL
```

Затем dry-run prune (раздел 12), при необходимости расширить диск,
очистить старые дампы. `DELETE` не уменьшает файл: место
переиспользуется autovacuum; при аномальном росте — `VACUUM (FULL)` в
окно обслуживания.

**Массовый ре-логин.** Сессии истекают по `SESSION_ABSOLUTE_TTL` (12h)
и `SESSION_IDLE_TTL` (2h), а также отзываются при смене роли, блокировке
и `revoke-sessions`. Проверить причину по `admin_audit_log` (кто и когда
отзывал) и `sessions`; данных это не теряет. Если сотрудники входят
одновременно, ограничитель `LOGIN_RATE_PER_MINUTE` может отклонять
входы — на время поднять значение и перезапустить admin-api.

## 15. Ссылки

- [local-run.md](local-run.md) — локальный dev-стек, e2e, фикстуры.
- [demo-stage-1.md](demo-stage-1.md) — аккаунты и подключения.
- [demo-stage-2.md](demo-stage-2.md) — операции и команды.
- [demo-stage-3.md](demo-stage-3.md) — статистика и настройки модулей.
- [demo-stage-4.md](demo-stage-4.md) — реестр, подписки, частичная
  доступность, метрики.
- [new-module.md](new-module.md) — подключение нового модуля/бекенда.
- [../design/architecture.md](../design/architecture.md) — топология.
- [../design/admin-db-schema.md](../design/admin-db-schema.md) — схема,
  retention, backup.
- [../adr/0013-admin-metrics.md](../adr/0013-admin-metrics.md) —
  метрики и labels.
- [../adr/0014-admin-db-retention.md](../adr/0014-admin-db-retention.md)
  — retention.
