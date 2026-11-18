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
- [ ] Docker targets фиксированы, default target core. Core nginx
  отвергает legacy `/managers`, managers сохраняет рабочий `/managers`.
- [ ] Демо suites запускаются отдельно, рабочие credentials не уходят
  в API. Demo nginx возвращает 404 на `/api/`.
- [ ] Независимая проверка собранных Docker images root завершена.

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

Дата 2026-11-18. Первая единица реализована, независимый Docker gate открыт. Коммит Admin фиксируется в Git
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
при demo chooser, синтетической форме и переходах. Полный `make check`,
Docker images и nginx runtime независимо проверяет root до следующей единицы.

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
