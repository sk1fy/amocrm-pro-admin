# Architecture Decision Records

Нумерация сквозная. ADR не редактируются задним числом: новое решение —
новый ADR со ссылкой на отменяемый.

| № | Решение | Статус |
| --- | --- | --- |
| [0001](0001-admin-api-placement.md) | Отдельный Admin API и admin read listener в Core | принято |
| [0002](0002-frontend-stack.md) | Стек frontend | принято |
| [0003](0003-employee-sessions.md) | Вход сотрудников, сессии и роли | принято |
| [0004](0004-observations-and-states.md) | Наблюдения, свежесть и словарь состояний | принято |
| [0005](0005-admin-db-migrations.md) | Миграции admin DB | принято |
| [0006](0006-trusted-proxy-headers.md) | Доверие заголовкам прокси | принято; выбор адреса заменён ADR-0022 |
| [0007](0007-account-filter-scans.md) | Ограниченный скан для фильтров списка аккаунтов | принято |
| [0008](0008-account-stream-pagination.md) | Курсоры истории и операций аккаунта | принято |
| [0009](0009-durable-admin-operations.md) | Устойчивые операции и диагностика | принято |
| [0010](0010-stage-3-activity-stats.md) | Activity, lead-status и статистика | принято |
| [0011](0011-adapter-contract-v1.md) | Контракт адаптера бекенда v1 | принято |
| [0012](0012-subscriptions-source.md) | Источник подписок | принято |
| [0013](0013-admin-metrics.md) | Метрики Prometheus Admin API | принято |
| [0014](0014-admin-db-retention.md) | Retention и объём admin DB | принято |
| [0015](0015-connection-diagnostics-ux.md) | Диагностика подключения в UI | принято |
| [0016](0016-atomic-employee-access.md) | Атомарное изменение доступа сотрудников | принято |
| [0017](0017-connection-state-freshness.md) | Актуальность состояния установок | принято |
| [0018](0018-distribution-diagnostics.md) | Диагностика распределения | принято |
| [0019](0019-digital-pipeline-diagnostics.md) | Совместимость DP диагностики | решение зафиксировано |
| [0020](0020-account-crm-users.md) | Пользователи amoCRM в карточке аккаунта | принято |
| [0021](0021-calm-interface.md) | Спокойный интерфейс: норма без выделения | принято |
| [0022](0022-rightmost-forwarded-address.md) | Правое значение X-Forwarded-For | принято |

- [0023: локальная сессия менеджерского демо](0023-manager-demo-session.md).
- [0024: отдельная сессия кабинета менеджеров](0024-manager-auth-audience.md).
- [0025: менеджерский BFF и операции Platform V1](0025-manager-platform-bff.md).
- [0026. Версии карточки клиента и повтор команды](0026-manager-account-revisions.md).
- [0027. Менеджерские identities и атомарный доступ](0027-manager-staff-identity.md).

- [0028. Назначение frontend задаётся при сборке](0028-frontend-build-purpose.md).
