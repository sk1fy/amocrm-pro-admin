# Рабочий выпуск кабинета менеджеров V1, A08

## Объём

Цель A08 состоит в двух рабочих frontend-артефактах, отдельном тестовом
демо и локальной приёмке собранного выпуска. Порядок пользователя сохраняется.
P11 принят на Core `1b99ad0`, затем A08, затем автоматический локальный A09.
P10 пропущен. Проверку собственного аккаунта amoCRM выполняет пользователь.
Публикация образов и production deployment в этот план не входят.

Основа Admin `495cead`, A07. Сверены Core
`amocrm-pro` на `1b99ad0`, список миграций до 000038,
`internal/apicontract/routes.go`, `internal/serviceapi/contracts.go`,
`cmd/integrations/main.go`, `cmd/activity-control/main.go` и runbook
`docs/runbooks/platform-v1-release.md`. A08 не меняет публичный API Core,
семантику P11, контракты Admin или схемы БД.

После review `e563540` добавлена узкая часть исправлений трёх P2.
Она согласует browser Host с уже принятым ingress-контрактом и обновляет
инструкции ротации DB-пароля и подключения Prometheus. Core не меняется.

Первая единица меняет только сборку frontend и её потребителей.
Назначения `core`, `managers`, `demo` выбирают фиксированные entry и output.
Core больше не импортирует demo router, fixtures или chooser.
ManagerApp сохраняет пять рабочих разделов без нового router.
Demo использует прежние синтетические boards без рабочего входа и API.
TanStack Register разделён независимыми TypeScript programs.

Следующие единицы остаются открытыми:

1. Release manifest и единственный TLS ingress для двух origin, приватные
   API и БД, обязательные read-only mTLS mounts. Миграция вызывающих мест
   старого production overlay и удаление заменённого workflow.
   Production startup запрещает fixture-kind backend registry. Сейчас
   catalog.Load не получает environment, development e2e должен сохраниться.
2. Обязательная Docker-first HTTPS-приёмка точных image IDs и ревизий,
   независимый review и полный `make check`. Настоящие Core и Platform
   берутся из P11. Contract fault peer используется только для отказов.
3. Runbook bootstrap, restart и rollback current → A07 → current.
   Минимальный совместимый Admin API `495cead` сохраняет technical_access
   и миграцию 000011. Альтернатива отката выключает manager ingress при
   текущем API. Pre-A07 API и down 000011 с manager-only identities запрещены.

## Throughput checkpoint

- Блокирующие шаги. Принять P11 и архитектурный синтез до изменений.
  Проверить compile/build isolation до release topology и HTTPS.
- Независимые потоки. Чтение Core и документация не зависят от сборки.
  Core, managers и demo строятся отдельно после общей проверки типов.
- Общее изменяемое состояние. Один владелец exclusive worktree
  в выделенной ветке A08. У TypeScript programs отдельные build info.
  Канонические Docker-проверки запускаются после передачи root.
- Минимальное безопасное разделение. Первая единица объединяет router,
  entry, TS configs, Vite guard, Docker targets и demo test consumers.
  Разделить их нельзя без состояния, в котором старые тесты или сборка
  используют уже удалённый маршрут. Следующая единица начинается после
  независимой проверки root.

## Приёмка

### Единица 1, compile и build isolation

- [x] `npm run lint` действительно проверяет `tsc -b` всей solution.
- [x] Все три явные build-команды проходят. Неизвестный purpose отклоняется.
- [x] `tsc --listFilesOnly` подтверждает один Register router на program.
  Транзитивные импорты не возвращают запрещённый router.
- [x] Guard проверяет modules реальных emitted chunks. Negative builds
  с импортом настоящих demo fixtures падают для core и managers.
- [x] Docker targets фиксированы, default target core. Core nginx
  отвергает legacy `/managers`, managers сохраняет рабочий `/managers`.
- [x] Демо suites запускаются отдельно, рабочие credentials не уходят
  в API. Demo nginx возвращает 404 на `/api/`.
- [x] Независимая проверка собранных Docker images root завершена.
  `/tmp/rakurs-a08-first-artifacts.log`, exit 0. Astra review без findings.
  Root также проверил Docker lint, 49 Vitest files, 225 tests и 6 build
  boundary cases. `/tmp/rakurs-a08-frontend-all.log`, exit 0.

### Единица 2, release topology

- [x] Старый production overlay удалён, все действующие инструкции
  используют самостоятельный release compose. Dev и demo отделены.
- [x] API, management, PostgreSQL и frontend не публикуются. Только ingress
  публикует loopback TLS. Platform network внешний, egress сохранён.
- [x] Обязательные images, origins и TLS/mTLS mounts не имеют dev fallback.
- [x] Production config запрещает fixture-kind, development сохраняет его.
  Проверка проходит через настоящий `config.LoadAPI` и `catalog.Load`.
- [x] Manifest проверяет Admin image IDs, revision, purpose labels,
  migration head и origins. Отрицательные mismatches отклоняются.
- [x] Постоянный `release-config-check` проверяет topology, отсутствие
  обязательных параметров, реальный `nginx -t` и неверные origins.
- [ ] Root независимо проверяет runtime Host/SNI/port и forwarding headers
  собранного ingress. Затем полная HTTPS browser acceptance.

### Полная A08

- [ ] Единственный доверенный TLS ingress проверяет Host, SNI, port,
  audience, Origin и spoofed forwarding headers. API не опубликован напрямую.
- [ ] Оба входа, logout, reload, deep links, Secure/HttpOnly/SameSite=Strict
  host-only cookies, grants и отзыв grants следующим запросом проверены.
- [ ] Пять разделов используют живые данные. Invitation fragment очищен.
  Manager-only identity не получает технический вход.
- [ ] Отказ, timeout и восстановление Platform видимы. Staff и Core доступны.
  Ошибки локальных mTLS файлов блокируют старт. Чужой корректный CA или
  удалённый SAN обнаруживаются handshake, без сетевого startup probe.
- [ ] Bootstrap проходит существующим CLI через техническую identity,
  затем приглашает отдельную manager-only identity. Последний admin защищён.
- [ ] Restart и rollback сохраняют identities, grants и историю.
- [ ] Обязательные acceptance specs падают без fixtures. Старые условные
  manager suites не считаются доказательством этой приёмки.
- [ ] `make check` и независимый review зелёные на точных ревизиях.

A09 запускается после принятия A08 как локальный сквозной сценарий с
настоящими Core, Platform и Admin. Production DNS, cutover и выдача
реальных прав не являются условием локальной приёмки и не считаются выполненными.

## Отчёт

Дата 2026-11-18. Первые две единицы реализованы. Первая принята root и Astra.
Release topology ожидает независимый runtime gate root. Коммит Admin фиксируется в Git
после проверок, база `495cead`. Core `1b99ad0` не менялся.

### Реализованные экраны и операции

Технический login содержит только рабочую форму. Отдельный demo entry
содержит chooser. Пять рабочих manager sections не менялись.

### Изменения контрактов и миграции

Admin API и Core admin без изменений. Миграций нет.

### Результаты проверок

| Команда | Репозиторий | Результат |
| --- | --- | --- |
| `npm run lint` | Admin frontend | ok, `tsc -b` всех programs, ESLint, Prettier |
| `npm run build:core`, `build:managers`, `build:demo` | Admin frontend | ok |
| `npm run test:build-boundaries` | Admin frontend | 6 ok, включая два отрицательных real fixture imports |
| `npm test -- --run manager/ManagerApp.test.tsx` | Admin frontend | 6 ok, рабочие разделы и session flow |
| `npm run test:e2e:demo` | Admin frontend | 11 ok на собранном dist-demo через Vite preview |
| `tsc --listFilesOnly -p tsconfig.{app,managers,demo}.json` | Admin frontend | core Register только в core, demo Register только в demo, manager без Register |
| `make docs-check` | Admin | ok |
| `docker-compose ... config --quiet` | Admin | ok для dev + e2e overlay |

Focused Node-проверки выполнены на Darwin с существующими node_modules
из отдельного UI checkout через неотслеживаемую ссылку. Это не Docker
runtime acceptance. TypeScript lists содержат 0 demo modules для core
и managers, 52 для demo. Production emitted graphs также проверены
настоящими Vite builds. Browser suite проверяет отсутствие API requests
при demo chooser, синтетической форме и переходах. Root проверил Docker images и nginx runtime до начала единицы 2.
Полный `make check` остаётся обязательной проверкой после неё.

### Инструкция запуска и демонстрационный сценарий

В `frontend` выполнить `npm run build:core`, `npm run build:managers`
или `npm run build:demo`. Docker использует соответствующий `--target`.
`npm run dev:demo` открывает отдельный тестовый chooser.
`npm run test:e2e:demo` использует `E2E_DEMO_BASE_URL`.
Канонический `make e2e` строит отдельный demo service и запускает оба suite.

### Происхождение данных демонстрации

Рабочие core/managers используют существующий Admin API.
Демо использует только синтетические fixtures в `src/features/managers`.
Изменения демо живут в React и сбрасываются при reload.

### Ограничения и зависимости следующего этапа

A08 открыта до release topology, manifest, HTTPS acceptance, полного
`make check` и независимого review. Первая единица не доказывает TLS,
серверные права или восстановление. A09 ещё не начата.

### Проверки release topology

`deploy/docker-compose.release.yml` заменяет старый production overlay.
Ingress строится из `deploy/ingress.Dockerfile`. Operator runbook описывает
точные image identities, обязательные mounts, bootstrap через существующую
техническую identity и минимальный безопасный rollback A07 `495cead`.
Все старые Admin binaries останавливаются до приглашений. Схема 000011
и `technical_access` не меняются.

| Проверка | Результат |
| --- | --- |
| Docker `go test -race -count=1 ./internal/catalog ./internal/platform/config ./cmd/admin-api` | ok, текущий source mounted в `/src` |
| `python3 deploy/scripts/test-release.py` | ok, точный manifest и 8 отрицательных mismatches |
| `release-config-check` | ok, реальный nginx image и пять неверных origins |

Для focused Go использован существующий toolchain image
`amocrm-admin-integration-test:local`, `f208a20ef025`, Go 1.26.11 с GCC.
Запуск через `--entrypoint sh` монтирует текущий backend; cached source
не используется. Логи находятся в `/tmp/rakurs-a08-topology-go.log` и
`/tmp/rakurs-a08-release-config.log`. Полный `make check` запускает root
после передачи. Параметры Core и Platform для следующей HTTPS единицы
берутся из принятого P11 manifest, а не соседнего main.

Соседний `../amocrm-pro` сейчас имеет main `47d5270`. Исходники
`internal/apicontract/routes.go` и `internal/serviceapi/contracts.go`
прочитаны, A08 их не меняет. Принятая версия P11 остаётся `1b99ad0`.
Новых пользовательских полей, HTTP contracts и миграций в единице 2 нет.

### Исправления независимого review единицы 2

В основе `e563540` приняты три P2. Core остаётся на принятой P11
`1b99ad0`; соседний основной checkout имеет `47d5270`. Сверены текущие
Core routes, service contracts, CLI entrypoints и миграции. Фактический
объём ограничен совместимостью browser Host и двумя инструкциями оператора.

API теперь сопоставляет канонический authority и единственный default-port
alias схемы. HTTPS допускает `:443`, development HTTP допускает `:80`.
Явно настроенный порт сравнивается точно. Это реализация уже принятого
контракта [ADR-0029](../adr/0029-release-ingress-and-identities.md),
а не новое решение. ADR не изменён. Исходный Host, ingress, Origin/CSRF,
сессии, cookies и технический режим без managers сохраняют свои правила.

Regression добавлен отдельным коммитом `7716102` до исправления.
Настоящий `New` router без cookies на обоих HTTPS `Host:443` вернул 404
вместо 401. Канонические Host и чужой маршрут дали ожидаемый результат.
Development HTTP aliases также воспроизвели тот же дефект.

Runbook ротации пароля обновляет независимый `DATABASE_URL` вместе с
`ADMIN_DB_PASSWORD`, различая percent-encoded пароль DSN и исходное
значение. API, CLI и migrate читают один DSN. Prometheus присоединяется
к существующей сети `amocrm-admin_web` проекта `amocrm-admin`.

Проверки выполнены через toolchain image `f208a20ef025`, Go 1.26.11,
`--entrypoint sh` и mounts текущих backend/docs в `/src` и `/docs`.
Отдельный Compose-проект `amocrm-admin-a08-fixes` поднял PostgreSQL,
текущий `go run ./cmd/admin-migrate up` применил миграции. После проверки
удалены только его контейнер, volume и сеть. Рабочий local-review сохранён.

| Проверка | Результат |
| --- | --- |
| `go test -race -count=1 ./internal/httpapi -run '^(TestBrowserHost.*\|TestManagerSessionBoundary\|TestCSRFRejectedOnLogin)$' -v` | ok, 4 верхнеуровневых теста без skip |
| `go test -race -count=1 ./internal/auth ./internal/platform/config` | ok с изолированной БД |
| `go vet ./internal/httpapi ./internal/auth ./internal/platform/config` | ok |
| `gofmt -l` двух изменённых Go-файлов | пусто |
| `make docs-check`, `git diff --check` | ok |

Логи до/после и focused run хранятся локально в `tmp/a08-fixes/`.
Проверены реальные router/audience/CSRF и существующая DB cookie isolation.
TLS proxy-only probe root не заменяет эту проверку backend auth.
Ротация реальных credentials и подключение рабочего Prometheus не
выполнялись. Инструкции сверены с общим `x-db-env` и API-сетью `web`
release compose. Полные `make check`, независимый review и HTTPS browser
acceptance остаются gates root. Новых полей, контрактов и миграций нет.
