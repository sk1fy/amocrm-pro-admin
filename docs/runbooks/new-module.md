# Подключение нового модуля и бекенда

Runbook для разработчика. Контракт адаптера заморожен в v1
([ADR-0011](../adr/0011-adapter-contract-v1.md),
[backend-adapter.md](../design/backend-adapter.md)); подключение нового
бекенда не должно менять сценарий поиска аккаунта. Эксплуатация
бекендов на хосте — [operator.md](operator.md). Готовый пример, который
прошёл весь путь, — fixture-модуль (раздел 6).

## 1. Контракт (чек-лист ADR-0011)

| Компонент | Обязательность |
| --- | --- |
| `adapter.Backend` | всегда |
| `Capabilities` | всегда |
| `CommandBackend` | если команды (`commands`) |
| `SettingsBackend` | если настройки (`settings`) |
| `StatsBackend` | если статистика (`stats`) |
| `SubscriptionBackend` | если подписки (`subscriptions`) |

`adapter.Backend` — это `Descriptor` (`Code`, `Kind`,
`ContractVersion`, `Timeout`), `Capabilities`, `Health` и чтение
аккаунтов, подключений, интеграций, jobs и аудита.

Возможность — единственный источник истины о доступности функции.
Флажок в `Capabilities` без интерфейса и интерфейс без флажка одинаково
запрещены: функция молча отвечала бы неверно. Пару проверяют
`adapter.AsSettings`, `AsStats`, `AsSubscription`; для команд —
утверждение типа вместе с `Capabilities().Commands`. Вызов метода без
такой проверки — ошибка адаптера. Read-only бекенд без опциональных
возможностей допустим.

Состояния и данные:

- каждое бекендное значение переводится в канон
  ([states.md](../design/states.md)); неизвестное значение → `unknown`,
  оригинал — в `State.Raw` (`MapSubscriptionState`, `MapSyncState`,
  `MapLeadStatusRun` в `backend/internal/adapter/mapping.go`);
- `active` не подставляется вместо неизвестного, `false` и `0` не
  заменяют отсутствующие факты;
- каждый метод возвращает `Observation[T]`: `observed_at`, `freshness`,
  `source`, безопасный `error`;
- типизированные ошибки `ErrUnavailable`, `ErrTimeout`, `ErrNotFound`,
  `ErrUnsupported`, `ErrInvalidArgument`, `ErrConflict`, `ErrRejected`;
  `ErrNotFound` — не сбой: источник доступен, факта просто нет;
- сообщение ошибки безопасно (без DSN, SQL, токенов, URL с
  параметрами) — оно попадает в HTTP-ответ;
- адаптер не знает о сотрудниках, ролях, сессиях и HTTP админки:
  получает `ctx`, фильтры и `Actor` (строка для аудита);
- секреты не покидают адаптер: ни в ответах, ни в `Raw`, ни в логах;
- локальные ID непрозрачны и адресуются как `{backend}/{id}`; связь с
  аккаунтом — только `AccountID` и `ProductCode`.

## 2. Регистрация

Адаптеры компилируются в сборку, динамической загрузки плагинов нет
(ADR-0011). Новый `kind` добавляется в `catalog.buildBackend`
(`backend/internal/catalog/catalog.go`); тестовый бекенд описывается
fixture-профилем. Затем — запись в `deploy/backends.yaml`:

```yaml
- code: newmod
  kind: newmod-http
  display_name: "Новый модуль"
  base_url: http://newmod:8080
  token_env: NEWMOD_ADMIN_TOKEN
  timeout: 5s
  health_path: /admin/v1/backend
  products:
    - code: newmod-product
      display_name: "Новый продукт"
```

- `code` — пространство имён URL и метрик, уникален в файле;
- `kind` — имя реализации в `buildBackend`;
- `base_url` и `token_env` обязательны для HTTP-адаптера;
- `timeout` (по умолчанию 5s) — персональный таймаут `Health` и
  вызовов; `health_path` по умолчанию `/admin/v1/backend`;
- `products` — коды каталога; ключ связи бекенда со сценариями и
  экраном настроек;
- `display_name` виден в реестре; при опущенном значении берётся
  `code`;
- секрета в файле нет: `token_env` называет переменную окружения;
  пустая или отсутствующая переменная — ошибка старта, а не значение
  по умолчанию;
- `kind: fixture` (`profile: demo|module`) — только dev/e2e; в проде
  блок `fixture` удаляется ([operator.md](operator.md), раздел 4).

## 3. Экраны

Общие экраны (поиск и карточка аккаунта, подключения, операции,
`/system`) работают автоматически: они читают контракт, а не код
модуля. Выбор такой:

- специальный экран не нужен — в интерфейсе ничего не добавляется,
  ссылка «Настройки» скрыта, а страница настроек показывает «Для этого
  модуля настройки недоступны»;
- модулю нужны собственные настройки — страница живёт в
  `frontend/src/features/connections/modules/<module>/` и
  регистрируется в
  `frontend/src/features/connections/modules/registry.ts` по кодам
  `products`; универсальный конструктор UI не строится (этап 4.1).

Новые маршруты и поля сверяются с
[screens.md](../design/screens.md) и
[data-sources.md](../design/data-sources.md). Пример:
`modules/activity/ActivitySettingsPage.tsx` привязан к продуктам
`activity` и `lead-status`; модуль без возможности `settings` ссылку не
показывает.

## 4. Тесты

Пути ниже — от `backend/internal/`, если не указано иное.

- Табличный unit: маппинг в канон, неизвестное → `unknown` + `Raw` —
  `adapter/mapping_test.go`.
- Unit возможностей: возможность без интерфейса → `ErrUnsupported` —
  `adapter/capabilities_test.go`.
- Таймаут: медленный адаптер не блокирует остальных —
  `catalog/catalog_test.go`.
- Частичная доступность: сбой одного адаптера не скрывает данные
  других — `accounts/multibackend_test.go`.
- Integration, реестр: `GET /system/backends` — `available`,
  `observed_at`, безопасная ошибка —
  `httpapi/stage4_integration_test.go`.
- Integration, данные: одна ветка нового бекенда и отсутствие
  секретов в ответе — `httpapi/*_integration_test.go`.
- Frontend unit: экран модуля, состояния, скрытие действий —
  `frontend/src/features/connections/**`.
- e2e: только при наличии отдельного экрана —
  `frontend/e2e/*.spec.ts`.

Маппинг подписок дополнительно покрыт
`adapter/fixture/subscription_test.go` (в том числе `grace_period` →
`unknown` + `Raw`).

## 5. Документация

| Изменение | Обновить |
| --- | --- |
| Новые поля интерфейса | `design/data-sources.md` |
| Новые состояния и правила показа | `design/states.md` |
| Новый экран | `design/screens.md` |
| Новое право | `design/roles.md` |
| Архитектурное решение | новый ADR в `docs/adr/` |
| Сценарий демонстрации | `runbooks/demo-stage-N.md` |

Процедуры на хосте (файл, переменные, ротация токена) не дублируются:
они в [operator.md](operator.md).

## 6. Пример: fixture-модуль

Второй бекенд уже подключён и служит доказательством, что расширение
не ломает работающий сценарий:

- `deploy/backends.yaml` — запись `fixture` с `profile: module`;
- `backend/internal/adapter/fixture/module.go` — четыре возможности
  (`accounts`, `connections`, `integrations`, `audit`), без settings,
  stats, subscriptions и команд; данные помечены `origin=fixture`;
- `deploy/backends-e2e.yaml` — тот же профиль рядом с fixture-`core`
  (`profile: demo`) для Playwright;
- `backend/internal/accounts/multibackend_test.go` — аккаунт 91000002
  собирается из подключений обоих бекендов; недоступность fixture не
  влияет на core и наоборот.

Сценарий поиска аккаунта при этом не менялся — это требование приёмки
этапа 4.

## 7. Проверка

1. `make check` — lint, unit, integration, docs-check.
2. `make e2e` — сквозные сценарии fixture-стека.
3. Войти и открыть `/system` (или запросить
   `GET /api/v1/system/backends` с сессией): новый бекенд `available`,
   `observed_at` свежий, ошибки нет, `contract_version` — `v1` или
   заявленная адаптером.
4. Остановить бекенд: источник `unavailable` с безопасной ошибкой,
   остальные данные читаются; после старта состояние возвращается.
