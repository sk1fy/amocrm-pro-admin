# План разработки

Этапы 1–4 завершены и сохранены ниже как исторический план и приёмочная запись.
Они не являются текущим backlog: на них ссылаются reviews, runbooks и ADR,
поэтому файлы этапов не удаляются. Новая работа оформляется отдельными
patch-планами с актуальной базой и собственными критериями приёмки.

## Активные patch-планы

| Приоритет | План | Статус |
| --- | --- | --- |
| P1 | [Актуальность состояния подключений](connection-state-freshness.md) | draft |

Завершённый patch, сохранён как приёмка:

| План | Статус |
| --- | --- |
| [Диагностика подключений в интерфейсе](connection-diagnostics-ux.md) | completed |

Итоговая сверка этапов и оставшихся эксплуатационных ограничений:
[audit-2026-09-14.md](audit-2026-09-14.md). Аудит документации:
[docs-audit-2026-09-19.md](../reviews/docs-audit-2026-09-19.md).

## Историческая база плана

Исходные четыре этапа адаптировались к фактическому коду `amocrm-pro` на
2026-09-12 (`main`, `76e89ef`). Каждый этап должен был заканчиваться работающим
приложением с реальными данными доступного backend; fixture разрешался только с
явной пометкой происхождения.

## Что уже решено

| Решение | Где |
| --- | --- |
| Отдельный Admin API в этом репозитории + admin read listener в `amocrm-pro/cmd/api` | [ADR-0001](../adr/0001-admin-api-placement.md), [architecture.md](../design/architecture.md) |
| Frontend: React + TypeScript + Vite + TanStack Router/Query, CSS Modules, npm | [ADR-0002](../adr/0002-frontend-stack.md) |
| Вход: email + argon2id, серверные сессии, cookie `SameSite=Strict`, роли viewer/operator/admin | [ADR-0003](../adr/0003-employee-sessions.md), [roles.md](../design/roles.md) |
| Все данные бекендов — наблюдения с `observed_at` и свежестью; канонический словарь состояний | [ADR-0004](../adr/0004-observations-and-states.md), [states.md](../design/states.md) |
| Экраны и маршруты | [screens.md](../design/screens.md) |
| Поле → источник → API | [data-sources.md](../design/data-sources.md) |
| Контракты API | [admin-api.md](../design/admin-api.md) |
| Основа адаптера бекенда | [backend-adapter.md](../design/backend-adapter.md) |

## Факты о бекенде, влияющие на план

- Core: Go 1.25, PostgreSQL 17, chi v5, pgx v5, slog. Все проверки — через
  Docker/Make (`make test`, `make openapi-check`, `make integration-test`);
  host Go не является поддержанным workflow.
- Персонального HTTP-чтения установок нет. Есть: CLI `cmd/integrations`
  (create/update/rotate-secret/enable/disable/set-service/
  disable-installation/enable-installation/revoke/uninstall), CLI
  `cmd/activity-control` (list/inspect/retry/pilot-enable/pilot-disable/
  panel-*), management listener (`/live`, `/ready`, `/metrics`,
  `/components`), management token для панелей Activity.
- Статусы установок: `pending, authorizing, active, reauth_required, disabled,
  uninstalled, error`; webhook: `pending, active, disabled, unregistered,
  error`; jobs: `queued, processing, retry, completed, failed, dead, cancelled`;
  outbox Activity: `pending_delivery, delivering, accepted, failed, expired`.
- `revoke` — локальная инвалидация, не remote OAuth revoke; `uninstall` может
  завершиться частично (`webhook_error`) после фиксации статуса (ADR-0018).
- Activity `SyncStatus` доступен только через порт с авторизацией актора
  (ADR-0011); административный контекст для него — задача этапа 3.
- Тест `api/openapi_test.go` требует точного соответствия `openapi.yaml` и
  `apicontract.Routes`: admin-маршруты идут в отдельный список.
- В Core нет HTTP-списков установок/интеграций/jobs/аудита и нет отдельного
  пакета аудита: хранилища мутационные (`integrations.Store.Apply` с
  строковым `Action`), `INSERT INTO audit_log` выполняется в транзакции
  каждого изменения. Чтение для админки пишется заново в `internal/adminread`.
- В `amocrm-pro` нет `.cursor/`, `AGENTS.md`, `CLAUDE.md`; правила — в
  `docs/README.md` (приоритет источников: код/миграции → ADR → Issues),
  `docs/project-memory/CONTEXT.md` (инварианты) и ADR-0003 (Docker-only).
- Локально запущен пилотный стек `amocrm-activity` (`docker-compose.activity.yml`,
  API `127.0.0.1:18080`, management `127.0.0.1:18082`); его Core DB на момент
  планирования пуста (0 интеграций, 0 установок). Реальные установки требуют
  OAuth с настоящим amoCRM.

## Завершённые этапы

| Этап | Цель | Файл |
| --- | --- | --- |
| 1 | Основа приложения и просмотр аккаунтов | [stage-1.md](stage-1.md) — завершён |
| 2 | Управление и восстановительные операции | [stage-2.md](stage-2.md) — завершён |
| 3 | Управление текущими модулями и статистика | [stage-3.md](stage-3.md) — завершён |
| 4 | Подключение будущих бекендов и выпуск | [stage-4.md](stage-4.md) — инженерная часть завершена |

## Исторический порядок работы внутри этапа

1. Перечитать [STYLE_GUIDE.md](../STYLE_GUIDE.md) и файл этапа.
2. Сверить факты раздела «Факты о бекенде» с актуальным `main` `amocrm-pro`;
   расхождения записать в файл этапа и в `data-sources.md`.
3. Заполнить раздел «Объём» файла этапа конкретными изменениями.
4. Выполнять части в указанном порядке; каждая часть — контракт, бекенд,
   интерфейс, проверка, документация.
5. По завершении — раздел «Отчёт» по шаблону стайл-гайда.

## Вне объёма всех четырёх этапов

Полный биллинг, клиентский личный кабинет, партнёрские разделы, финансовый
учёт, перенос старой базы, поиск пользователей и контактов без надёжного
источника, покрытие Grafana/Loki/Prometheus (только сводки и переходы).
