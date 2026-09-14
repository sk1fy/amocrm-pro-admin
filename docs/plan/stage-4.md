# Этап 4. Подключение будущих бекендов и выпуск

> Статус: инженерная часть завершена. Документ сохранён как исторический план и
> отчёт приёмки; production-ограничения перечислены ниже, текущий backlog — в
> [README](README.md).

**Цель:** проверить расширяемость и подготовить приложение к постоянной работе
команды.

> Блок «Объём» ниже описывает исторический старт этапа. Сверка текущего
> кода, исправления и незакрытая приёмка зафиксированы в
> [аудите 2026-09-14](audit-2026-09-14.md).

## Объём завершения — 2026-09-14

Актуальная база Admin — `main` / `a61063f`; этапы 4.1–4.3 и исправления
Admin-аудита уже слиты. Актуальная backend-работа объединяется в
`amocrm-pro/feature/admin-stage-4-completion`: исправления audit-hardening и
durable replay `PatchPanel` должны находиться на одном head и проходить полный
Core CI.

Для завершения инженерной части этапа требуется:

- подтвердить `make check` Admin и полный Core CI на объединённых heads;
- выполнить настоящий backup/restore Admin DB и сверить восстановленный
  snapshot, не сравнивая его с изменяемой live-БД;
- повторно подтвердить зафиксированный нагрузочный/EXPLAIN-прогон и fixture
  E2E-пилот;
- обновить отчёт, отделив выполненную инженерную приёмку от действий, которым
  нужны production OAuth, сотрудники, TLS-прокси и боевые credentials.

Полный перенос Activity-вызовов Core в outbox остаётся отдельной
межсервисной задачей, как и было определено исходным объёмом этапа ниже. В
текущем backend head durable replay закрывает `PatchPanel`, но не объявляется
универсальным recovery всех Activity-команд.

## Объём

Сверка 2026-09-13. Admin `3bd48f4` (ветка `feature/stage-4-release` от
`feature/stage-3-modules`); Core `feature/admin-activity` — рабочее
дерево с правками ревью этапа 3 (не закоммичено).

Что уже есть в коде Admin и служит основой:

- контракт адаптера v1 (`backend/internal/adapter`): `Descriptor`,
  `Capabilities`, `Observation`, типизированные ошибки; опциональные
  `CommandBackend`/`SettingsBackend`/`StatsBackend`; загрузчик
  `internal/catalog` (`deploy/backends.yaml`); агрегация аккаунтов по
  нескольким адаптерам в `accounts.Service`; тесты частичной
  доступности и таймаутов в `accounts` и `adapter/core`;
- `GET /api/v1/system/backends` отдаёт `Observation<Health>[]`
  (freshness, `observed_at`, error, revision, contract_version,
  capabilities, components); `/system` показывает только
  freshness/ревизию/контракт/возможности; вид и тип адаптера, время
  последнего ответа и ошибка в интерфейсе не выводятся;
- management listener Admin API: `/live`, `/ready`; `/metrics` нет,
  Prometheus-зависимости нет; `.env.example` упоминает `/metrics`
  ложно;
- fixture-адаптер в e2e заменяет Core (`kind: fixture`, code `core`);
  второй бекенд не подключён (`deploy/backends.yaml`, строки 22–26 —
  комментарий);
- миграции admin DB 000001–000005; retention/prune, prod-compose и
  backup-скрипты отсутствуют (backup описан только в
  admin-db-schema.md); fixture-нагрузки 10^4 нет (SQL-fixture — 8
  установок);
- runbooks: `local-run.md`, `demo-stage-1..3.md`; `operator.md` и
  `new-module.md` отсутствуют.

Фактический объём изменений этапа:

- 4.1 — финализация контракта v1 (`Capabilities.Names`, связь
  аккаунт/продукт, политика `ContractVersion`) в backend-adapter.md и
  ADR-0011; реестр бекендов с состоянием (доступность, версия, время
  последнего ответа, ошибка) в `GET /api/v1/system/backends` и таблицей
  на `/system`; тесты медленного/падающего адаптера; второй
  fixture-бекенд (`code: fixture`) в dev и e2e с явной меткой, слияние
  карточки аккаунта, недоступность fixture не влияет на Core; страница
  настроек модуля выбирается по возможностям и продуктам бекенда;
- 4.2 — `SubscriptionSource` (тариф, срок действия, состояние,
  предоставленные возможности) как опциональный интерфейс и
  capability; `GET /api/v1/accounts/{id}/subscription`; fixture-данные
  для части аккаунтов, для остальных — `unknown` («данные подписки
  недоступны»); блок на карточке аккаунта; ADR-0012;
- 4.3 — метрики Prometheus на management listener (`/metrics`,
  конечные labels `route`/`method`/`status`/`backend`/`outcome`,
  ADR-0013); retention/prune аудита и операций (ADR-0014,
  `admin-cli prune`, индексы); backup/restore admin DB
  (`pg_dump --format=custom`, make-цели, проверка restore); compose для
  целевого хоста и ротация credentials; нагрузка — fixture на 10^4
  аккаунтов и EXPLAIN тяжёлых Core admin read запросов (по
  возможности пилотного стека); runbooks `operator.md`,
  `new-module.md`, `demo-stage-4.md`, чек-лист пилота; закрытие
  замечаний ревью этапа 3 на стороне Admin (общие saved views, подписи
  настроек, default period).

Вне объёма этапа: платежи/продления подписок; покрытие
Grafana/Loki (только ссылки); перенос внешних вызовов Activity за
транзакцию квитанции Core (issue 6 ревью этапа 3) — фиксируется в
отчёте как ограничение, если не будет выполнен.

Базовая проверка `make check` на старте этапа: `lint` падал на
Prettier в 8 файлах frontend; форматирование исправлено до начала
работ.

## Части

### 4.1. Контракт адаптера v1 — завершение

- Финализировать [backend-adapter.md](../design/backend-adapter.md):
  `ContractVersion`, `Capabilities` (подключения, диагностика, настройки,
  команды, операции, статистика), связь локальных ID с аккаунтом и продуктом.
- Реестр бекендов: доступность, версия, время последнего ответа, ошибка —
  в `GET /api/v1/system/backends` и на экране Система.
- Таймауты и частичные ответы: тесты с медленным/падающим адаптером.
- Разделение общих экранов и специализированных страниц модулей: модуль может
  иметь собственную страницу настроек внутри подключения, используя общие
  авторизацию, навигацию и операции. Универсальный конструктор UI не строится.
- Тестовый адаптер `adapter/fixture` подключается вторым бекендом с явной
  меткой `fixture`; общая карточка аккаунта показывает подключения обоих
  бекендов; отключение fixture не влияет на Core.

### 4.2. Подготовка к подпискам

- Интерфейс `SubscriptionSource` (тариф, срок действия, состояние,
  предоставленные возможности) — отдельно от технического гранта сервиса.
- При отсутствии источника — «данные подписки недоступны» (`unknown`).
- Проверка на данных fixture-адаптера. Тарифы, платежи, продления — позже.

### 4.3. Эксплуатация

- Сборка образов, compose для целевого хоста, конфигурация бекендов и
  служебных credentials (ротация `ADMIN_API_TOKEN`, cookie secret).
- Наблюдаемость Admin API: `/live`, `/ready`, `/metrics` на отдельном
  listener; метрики с конечными labels (`route`, `status`, `backend`,
  `outcome`); ID в labels запрещены.
- Хранение аудита и агрегатов: retention, индексы, объём.
- Резервное копирование admin DB (`pg_dump --format=custom`), проверка restore
  в новую БД.
- Нагрузка: большие списки (10⁴–10⁵ установок в fixture), самые тяжёлые запросы
  Core admin read с `EXPLAIN`.
- Пилот с сотрудниками на типовых обращениях; фиксация результатов.
- Инструкция оператора и инструкция подключения нового модуля.

## Приёмка

- Новый тестовый бекенд подключается без переделки сценария поиска аккаунта.
- Его недоступность не блокирует остальные подключения.
- Роли, отзыв доступа сотрудника и аудит изменений проверены сквозным тестом.
- Сквозные сценарии поиска, диагностики, восстановления и изменения настроек
  пройдены и записаны.
- Зафиксированы фактические ограничения и результаты пилота.

## Сверка и доработка после реализации — 2026-09-14

Проверяемая база Admin — `main` / `c6e3bac`, Core —
`feature/admin-activity` / `dd2a4a5`. Метрики, второй fixture,
подписки fixture, prune, production overlay и backup/restore уже
присутствуют; исторический список отсутствующего кода выше не является
текущим backlog.

Подготовлены исправления проверки JSON, канонизации команд и имён полей
аудита, безопасного создания scratch DB, прав/уникальности dump-файлов,
полноты `make check` и CI. Подробности, приоритеты и совместимость —
в [отчёте аудита](audit-2026-09-14.md).

Историческое состояние проверки выше заменено итоговым отчётом ниже.

## Отчёт

Дата: 2026-09-14. Коммиты: amocrm-pro-admin `0bb216d` и этот отчёт;
amocrm-pro `190b09f`.

Статус: инженерная реализация и воспроизводимая локальная приёмка этапа 4
завершены. Production rollout остаётся отдельным эксплуатационным gate,
поскольку требует целевого хоста, реальных credentials и участников пилота.

### Реализованные экраны и операции

- реестр нескольких бекендов, их capabilities, состояние и частичная
  доступность;
- подписки fixture с честным `unknown` при отсутствии источника;
- специализированные страницы модулей, метрики, retention/prune;
- production overlay, backup/restore и инструкции оператора/нового модуля;
- сквозные роли, отзыв сессии, аудит и 22 браузерных сценария.

### Изменения контрактов и миграции

- Admin API: новых маршрутов в completion-патче нет;
- Core admin: объединены integer-safe canonicalization, CAS/409 hardening,
  транзакционная запись lead-status и durable replay `PatchPanel`;
- миграции Admin DB: без новых; Activity DB:
  `000004_panel_patch_results`;
- backup использует переносимый BSD/GNU `mktemp`, уникальные имена и приватные
  права даже для двух запусков в одну секунду.

### Результаты проверок

| Команда | Репозиторий | Результат |
| --- | --- | --- |
| `make check` | amocrm-pro-admin | ok после исправления portable `mktemp`; 22 Playwright E2E |
| `make bench-admin` | amocrm-pro-admin | ok; 10k/100k fixture accounts |
| настоящий `backup-db` + `restore-check` | amocrm-pro-admin | ok; 2 employees и 16 audit rows, scratch удалена |
| `make fmt-check vet test openapi-check` | amocrm-pro | ok |
| `make integration-test` | amocrm-pro | ok, PostgreSQL tests выполнены |
| `make activity-ci` | amocrm-pro | ok, owner restore и process fault tests выполнены |

Нагрузочный Core EXPLAIN на 100 тысячах installations и результаты 26 запросов
зафиксированы в
[отчёте нагрузки](../reviews/stage-4-load-2026-09-13.md). Повторный Admin
benchmark подтвердил выполнение всех шести сценариев; наиболее дорогой
fixture scan на 100 тысячах аккаунтов занял около 365 мс и 1,25 GB/op.

### Инструкция запуска и демонстрационный сценарий

- [local-run.md](../runbooks/local-run.md);
- [demo-stage-4.md](../runbooks/demo-stage-4.md);
- [operator.md](../runbooks/operator.md);
- [new-module.md](../runbooks/new-module.md).

### Происхождение данных демонстрации

- `fixture`: все автоматические браузерные, нагрузочные и restore acceptance
  данные явно помечены и используют домены `*.example.invalid`/`*.amocrm.test`;
- `real`: production OAuth и реальные аккаунты в этой приёмке не использовались.

### Ограничения и production gate

- Полный outbox/read-only recovery всех Activity-команд остаётся отдельной
  межсервисной задачей вне исходного объёма этапа 4. Для `PatchPanel` durable
  replay реализован; универсальная гарантия для configure/create/rotate не
  заявляется.
- Перед production запуском оператор должен настроить TLS reverse proxy,
  реальные credentials и PostgreSQL-роли, затем провести OAuth smoke и пилот
  с сотрудниками. Эти действия нельзя достоверно заменить fixture CI.
- Приёмочный restore с точным сравнением выполняется в окне без writers;
  порядок явно добавлен в `operator.md`.
