# РС-09 — диагностика распределения

## Объём

База: amocrm-pro `93f556a`; admin локальная `main`, без pull.
Новая работа выполняется в `codex/lead-distribution-stage-09`.

Core владеет API диагностики и восстановлением. Admin читает только его
HTTP admin listener; TeamOS DB недоступна. Источники OAuth и webhook
переиспользуются из существующей карточки.

1. Версионированные summary и trace через optional адаптер распределения.
2. Секция карточки: наблюдения, состояния, backlog, поиск UUID и пагинация.
3. Восстановление через существующие durable admin операции с текущими
   правами, 202, неизменным ключом и аудитом; неизвестный результат не успех.
4. Табличные проверки маппинга, отказов, прав, HTTP контракт, fixture E2E.
5. Runbook, демонстрация, ADR и обязательные design документы.

## Приёмка

- Нет секретов, сырых payload и прямого доступа к чужим БД.
- Нет данных, ноль, устаревание и недоступность различаются.
- Все новые маршруты соответствуют OpenAPI; роли проверяет сервер.
- `make check` проходит. Fixture явно помечен, живой OAuth и установленный
  amoCRM виджет остаются отдельной проверкой после тестовой среды.

## Отчёт

Дата: 2026-10-03. Локальная инженерная часть завершена.
Коммиты фиксируются в итоговом комментарии РС-09 после записи в Git.

### Реализованные экраны и операции

- Summary/trace в карточке установки: честные Observation, граница Core
  и TeamOS, источник, fixture, unknown/stale/unavailable, UUID-поиск.
- Cursor pagination; opaque fixture cursor и numeric URL validation.
- Проверка OAuth/webhook, scoped pause/resume, frozen delivery retry и
  GET-проверка существующего unknown назначения через durable операции.
- Intent каждой trace-команды изолирован по message/operation ID; reload
  восстанавливает только её request key и не отправляет новую команду.

### Изменения контрактов и миграции

Admin API: два GET distribution маршрута и типизированные безопасные DTO.
Core admin: distribution-read/commands, trace, пауза и восстановление.
Admin DB: миграций нет; Core: 000021_distribution_admin_pause.
Новых прав нет; используются текущие connections:read/disable/check,
webhooks:reconcile и operations:retry. Core владеет scope/CAS/эффектами.

### Результаты проверок

| Проверка | Результат |
| --- | --- |
| Docker gofmt/vet/golangci, race unit | PASS, 0 lint issues |
| Изолированный PostgreSQL, up/down | PASS, включая новый HTTP/RBAC/replay |
| Последний fixture/core/контракт Go | PASS после opaque cursor |
| Final frontend lint/build/107 unit | PASS, 31 файл |
| Final fixture Playwright | PASS, 31 сценарий |
| Backup scripts | PASS, 11 doubles; не реальный restore |
| govulncheck | PASS, 0 reachable vulnerabilities |
| docs-check | PASS |

Первый `make check` остановился на новом E2E: numeric fixture cursor
TanStack преобразовал в number и валидатор потерял фильтр. Исправлены
opaque cursor и narrow normalizer. Последние frontend/build/E2E и
остальные targets прогнаны отдельно; это не единый успешный exit `make
check`. Backend/PG исходники после базового прогона не менялись, кроме
fixture cursor, дополнительно проверенного профильными Go tests.

### Запуск и демонстрационный сценарий

[Runbook](../runbooks/lead-distribution.md). `make e2e
E2E_ARTIFACTS_DIR=/tmp/rs09-artifacts` сохраняет 1440/390 screenshots и
нативные Playwright результаты вне repo. Интерфейс проверен визуально;
мобильная таблица прокручивается внутри блока, overflow страницы нет.

### Происхождение данных и ограничения

E2E: явный fixture adapter и вымышленные аккаунт/сотрудники/сделка.
Core PostgreSQL/worker тесты: реальные локальные компоненты с CRM fixture,
не живой amoCRM. Установленный ZIP, OAuth/re-OAuth, реальная CRM-подписка
и назначение, целевой сервер и реальное переключение здесь не проверены.
Варианты внешней проверки публикуются отдельным комментарием РС-09.
