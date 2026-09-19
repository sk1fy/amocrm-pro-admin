# Ракурс — внутренняя админ-панель

Отдельное приложение для ограниченного круга сотрудников команды: поиск аккаунтов
amoCRM, проверка подключённых виджетов, диагностика и восстановление через
операции, поддержанные бекендом.

Основной сценарий:

**Найти аккаунт → проверить подключённые виджеты → установить причину проблемы →
выполнить действие → проверить результат.**

Основной бекенд: [sk1fy/amocrm-pro](https://github.com/sk1fy/amocrm-pro)
(локально `../amocrm-pro`). Старая админка `../rakurs-ssd` (Laravel/Filament)
используется только как источник рабочих сценариев; её стек и структура разделов
не переносятся.

## Состояние

Этапы 1–4 завершены и находятся в `main`: вход и роли, чтение и управление
подключениями, Activity/lead-status, статистика, несколько backend-адаптеров и
эксплуатационные инструменты. Связка с Core и server observability проверены на
целевом сервере 14 сентября 2026 года.

Текущая следующая работа — устранение неоднозначности и устаревания состояния
подключений: [connection-state-freshness.md](docs/plan/connection-state-freshness.md).
Запуск: [local-run.md](docs/runbooks/local-run.md), эксплуатация:
[operator.md](docs/runbooks/operator.md).

## С чего начать

| Кому | Читать |
| --- | --- |
| Агент-разработчик | [AGENTS.md](AGENTS.md) → [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md) |
| Индекс документации | [docs/README.md](docs/README.md) |
| Обзор решений, завершённые этапы и patch-планы | [docs/plan/README.md](docs/plan/README.md) |
| Ближайшая работа | [docs/plan/connection-state-freshness.md](docs/plan/connection-state-freshness.md) |
| Как устроено размещение и границы | [docs/design/architecture.md](docs/design/architecture.md) |
| Экраны и переходы | [docs/design/screens.md](docs/design/screens.md) |
| Словарь состояний | [docs/design/states.md](docs/design/states.md) |
| Поле интерфейса → источник → API | [docs/design/data-sources.md](docs/design/data-sources.md) |
| Роли и права | [docs/design/roles.md](docs/design/roles.md) |
| Контракты Admin API и Core admin read | [docs/design/admin-api.md](docs/design/admin-api.md) |
| Контракт адаптера бекенда | [docs/design/backend-adapter.md](docs/design/backend-adapter.md) |
| Схема собственной БД | [docs/design/admin-db-schema.md](docs/design/admin-db-schema.md) |
| Локальный запуск и fixtures | [docs/runbooks/local-run.md](docs/runbooks/local-run.md) |
| Полный операторский сценарий | [docs/runbooks/operator.md](docs/runbooks/operator.md) |
| Принятые решения | [docs/adr/](docs/adr/) |

## Структура репозитория

```text
backend/            Go Admin API (собственная PostgreSQL: сотрудники, сессии, аудит)
  cmd/admin-api/    HTTP-сервис
  cmd/admin-cli/    bootstrap сотрудников, служебные команды
  internal/         auth, rbac, adapters, accounts, operations, http
  migrations/       versioned up/down миграции admin DB
frontend/           React + TypeScript + Vite
deploy/             docker-compose, конфигурация бекендов, fixtures с явной пометкой
docs/               план, дизайн, ADR, стайл-гайд, инструкции оператора
Makefile            Docker-first команды: build, up, test, lint, migrate
```

Изменения в `amocrm-pro` (Core admin read listener, контракт, ADR) выполняются
в том репозитории на отдельной ветке по его правилам; см.
[architecture.md](docs/design/architecture.md#core-admin-в-amocrm-pro).
