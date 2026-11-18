# Инструкция оператора

Эксплуатация админки на целевом хосте: роли и доступ, развёртывание
самостоятельного выпуска, ротация credentials, наблюдаемость, retention, backup и
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

Подготовьте два DNS имени и TLS certificate с обоими SAN. Единственный
TLS ingress из выпуска принимает оба origin. Перед ним нет другого
proxy или балансировщика. Он публикуется только на loopback. Для доступа
снаружи требуется отдельно разрешённая сетевая конфигурация хоста.
Прямые API, management, frontend и БД не публикуются.

Подготовьте Docker Engine, Compose, Python 3 для verifier, постоянный
volume `admin-postgres-data`, каталог backups и внешние Docker networks
Core admin и Platform. API имеет обычную egress bridge для исходящих
запросов. Это не firewall по адресатам.

```sh
cd /opt/amocrm-pro-admin
ENV_FILE=/etc/amocrm-admin/admin.env
FILES="-f deploy/docker-compose.release.yml"
DC=${DC:-docker-compose}
dc() { $DC -p amocrm-admin --env-file "$ENV_FILE" $FILES "$@"; }
```

Не накладывайте release compose на dev compose. Проект `amocrm-admin`
фиксирует volume и сети. При переходе со старого проекта сначала
остановите все старые Admin API, сохранив volume и схему. Проверьте,
что не осталось старых реплик, systemd units и API на другом хосте.
До этого не открывайте приглашения. Pre-A07 binary игнорирует
`technical_access=false` и может разрешить технический вход приглашённому.

## 3. Соберите и зафиксируйте образы

Соберите backend targets `admin-api`, `migrate`, `admin-cli`, frontend
`core`, `managers` и `deploy/ingress.Dockerfile`. Для всех передайте
одинаковый `BUILD_REVISION` с полной Git revision чистого checkout.
`make build` остаётся dev-командой. Demo image в release не входит.

```sh
REV=$(git rev-parse HEAD)
docker build --target admin-api --build-arg BUILD_REVISION="$REV" \
  -t admin-api:release backend
docker build --target migrate --build-arg BUILD_REVISION="$REV" \
  -t admin-migrate:release backend
docker build --target admin-cli --build-arg BUILD_REVISION="$REV" \
  -t admin-cli:release backend
docker build --target core --build-arg BUILD_REVISION="$REV" \
  -t admin-core:release frontend
docker build --target managers --build-arg BUILD_REVISION="$REV" \
  -t admin-managers:release frontend
docker build -f deploy/ingress.Dockerfile \
  --build-arg BUILD_REVISION="$REV" -t admin-ingress:release deploy
```

Для локального запуска получите `docker image inspect --format
'{{.Id}}' IMAGE`. В env используйте этот `sha256` ID. Для уже
опубликованного образа используйте reference с registry digest.
Публикация образов является отдельным действием оператора.
PostgreSQL также закрепляется immutable reference.

## 4. Подготовьте registry и файлы mTLS

Скопируйте `deploy/backends.yaml` в операторский файл. Удалите fixture
entries и задайте доступные из контейнера Core admin и CRM listener.
Production API отвергает весь registry, содержащий `kind: fixture`.
Секреты задаются через имена `token_env`, без значений в YAML.

Подготовьте CA Platform и отдельный BFF client certificate и key с URI
`spiffe://amocrm-pro/manager-bff`. Файлы монтируются read-only. API
работает как UID 10001. Дайте ему чтение файлов, сохранив ограниченные
права на приватный ключ. Не кладите ключи в image, Git или логи.

Отсутствующий файл, невалидный PEM, несовпадающая key pair и неверный
локальный BFF URI останавливают API. Корректный чужой CA или неверный
удалённый SAN обнаруживаются во время handshake запроса. Они дают
недоступность Platform. Core и Staff продолжают работать. Сетевой
startup probe отсутствует.

## 5. Заполните release environment и manifest

В `/etc/amocrm-admin/admin.env` с правами 0600 задайте все переменные.
Локальных fallback для release images, origins и секретов нет.

| Переменные | Значение |
| --- | --- |
| `ADMIN_API_IMAGE`, `MIGRATE_IMAGE`, `ADMIN_CLI_IMAGE` | Immutable references трёх backend targets |
| `ADMIN_CORE_IMAGE`, `ADMIN_MANAGERS_IMAGE` | Immutable references двух frontend targets |
| `ADMIN_INGRESS_IMAGE`, `ADMIN_POSTGRES_IMAGE` | Immutable references ingress и PostgreSQL |
| `POSTGRES_DB`, `POSTGRES_USER`, `ADMIN_DB_PASSWORD` | Параметры отдельной Admin DB |
| `DATABASE_URL` | DSN этой БД на `admin-postgres:5432`, согласованный с credentials |
| `MIGRATION_TIMEOUT` | Положительная длительность миграции |
| `ADMIN_PUBLIC_ORIGIN`, `MANAGERS_PUBLIC_ORIGIN` | Разные точные HTTPS DNS origins |
| `ADMIN_TLS_PORT` | Loopback порт хоста, по умолчанию 443 |
| `ADMIN_TLS_CERT_PATH`, `ADMIN_TLS_KEY_PATH` | Абсолютные пути TLS certificate и key |
| `BACKENDS_FILE_PATH`, `CORE_ADMIN_API_TOKEN` | Registry и токен Core listener |
| `CORE_ADMIN_NETWORK`, `MANAGERS_PLATFORM_NETWORK` | Существующие внешние Docker networks |
| `MANAGERS_PLATFORM_URL` | HTTPS адрес Platform с DNS именем из SAN |
| `MANAGERS_PLATFORM_TIMEOUT` | Длительность от 1s до 30s |
| `MANAGERS_PLATFORM_CA_PATH` | Абсолютный путь CA Platform |
| `MANAGERS_PLATFORM_CERT_PATH`, `MANAGERS_PLATFORM_KEY_PATH` | Абсолютные пути BFF certificate и key |

Origin не содержит path, завершающий slash, query или fragment.
Нестандартный порт входит в origin и совпадает с опубликованным портом.
Host без порта и с `:443` допустимы только для стандартного HTTPS.

Сохраните JSON manifest с `schemaVersion=1`, `adminRevision` полной
Git revision, `minimumCompatibleAdminRevision="495cead"`,
`migrationHead="000011"`. Объект `origins` содержит точные значения
`ADMIN_PUBLIC_ORIGIN` и `MANAGERS_PUBLIC_ORIGIN`. Объект `images` содержит
ровно ключи `admin-api`, `admin-cli`, `migrate`, `core-frontend`,
`managers-frontend`, `ingress`, `admin-postgres`. Каждое значение содержит
`reference` из env и `imageId` из Docker inspect. Labels фиксируют
назначение и revision всех Admin images. PostgreSQL проверяется по ID.

```sh
umask 077
dc --profile tools config --format json > /tmp/admin-release.json
python3 deploy/scripts/verify-release.py \
  /etc/amocrm-admin/release.json /tmp/admin-release.json
rm /tmp/admin-release.json
```

Resolved Compose содержит секреты. Не сохраняйте его в отчёт или Git.
Verifier сверяет локальные image metadata и выбор компонентов. Он не
подтверждает происхождение бинаря или поведение. У Admin API нет
`--version`. После проверки нужны сценарии acceptance из плана A08.

## 6. Запустите выпуск и назначьте первого manager admin

```sh
dc config --quiet
dc up --detach --wait
dc ps
```

Registry digest предварительно загрузите через `dc pull`.
Локальные image IDs не требуют registry. Миграции выполняются до API.
Два origin обслуживает ingress, неизвестный Host или SNI отвергается.

Первого manager admin назначьте существующей уполномоченной технической
identity с паролем, без смены её `technical_access`.

```sh
dc --profile tools run --rm admin-cli employee bootstrap-manager \
  --email authorized-admin@example.invalid
```

Затем через manager Staff пригласите отдельную manager-only identity.
Проверьте вход, grants и отказ технического login. Не расширяйте права
приглашённого ради bootstrap. Сохраните исходную техническую identity
для восстановления. Последнего manager admin нельзя удалить или лишить
права администрирования без замены.

## 7. Примените миграции и выполните безопасный откат

Сделайте backup перед обновлением. API проверяет `EnsureCurrent` и
не запускается при неприменённых миграциях.

```sh
dc run --rm migrate up
```

Минимальная совместимая версия Admin API для отката имеет revision
`495cead`, A07. Сохраните схему 000011, identities, grants, receipts и
history. Не выполняйте `000011 down`. Pre-A07 binary игнорирует
`technical_access=false` и запрещён после появления manager-only identity.

Для отката UI оставьте текущий API. Для отката API остановите приём
новых manager команд, дождитесь завершения текущих intent сверок либо
остановите текущий процесс. Запустите A07 с полной сохранённой схемой
миграций и совместимым intent protocol. Локальная проверка
current → A07 → current с сохранением данных остаётся обязательной
приёмкой A08. Пока она не принята, безопасная альтернатива сохраняет
текущий API и закрывает manager ingress операторским правилом доступа.

Не удаляйте identities и историю и не меняйте `technical_access` для
облегчения отката. После возврата текущего API проверьте восстановление
сверок и отказ технического login приглашённому сотруднику.

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

Сквозной сценарий экранов — [демонстрация](demo-stage-4.md).

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
3. В `/etc/amocrm-admin/admin.env` обновить `ADMIN_DB_PASSWORD` и
   пароль в `DATABASE_URL`. Это независимые значения: release compose
   не строит DSN из `ADMIN_DB_PASSWORD`. В URL пароль должен быть
   percent-encoded, в `ADMIN_DB_PASSWORD` хранится исходный пароль.
   Не менять hostname `admin-postgres`, порт, имя БД и параметры DSN.
4. Пересоздать postgres и admin-api, чтобы env совпал с БД:
   `dc up --detach --force-recreate admin-postgres admin-api`.
   Пересоздание postgres не трогает volume с данными; это важно и для
   `restore-check`, который читает `POSTGRES_PASSWORD` из контейнера.
5. Проверить `/ready` и вход. API, `migrate` и `admin-cli` используют
   один `DATABASE_URL` из обновлённого env-файла. Отдельно пересоздавать
   одноразовые `migrate`/`admin-cli` не нужно: каждый новый запуск `dc`
   читает этот файл.

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
подключается к внутренней сети `web` release compose, где доступен API.
Для проекта `amocrm-admin`, указанного в функции `dc` выше:

```sh
docker network connect amocrm-admin_web <prometheus-container>
```

Если изменён `-p`, заменить префикс `amocrm-admin` именем этого проекта.
Management listener остаётся без опубликованного порта.

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
    --env-file /etc/amocrm-admin/admin.env" \
  COMPOSE_FILE=deploy/docker-compose.release.yml
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
    --env-file /etc/amocrm-admin/admin.env" \
  COMPOSE_FILE=deploy/docker-compose.release.yml
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
`ADMIN_DB_PASSWORD` с БД (раздел 10), занятый TLS порт, невалидный env
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

## Проверки подключений

Время backend-снимка и время проверки amoCRM различаются. Состояние active
означает установку; подтверждённый доступ требует свежего verification.
Новое расписание Core изначально выключено. Порядок pilot rollout и env:
[Core runbook](https://github.com/sk1fy/amocrm-pro/blob/79011d1b28fcc13a6dbe9bdcf5b4bdccd80cd888/docs/runbooks/connection-verification.md).
Не включать весь охват до 24-часового наблюдения pilot. Отключение scheduler
оставляет ручные проверки и polling интерфейса рабочими.
