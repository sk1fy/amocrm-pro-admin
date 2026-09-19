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
| [0006](0006-trusted-proxy-headers.md) | Доверие заголовкам прокси | принято |
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

Следующее ожидаемое решение — фоновая актуальность состояния
подключений, если patch-план
[connection-state-freshness.md](../plan/connection-state-freshness.md)
потребует изменения модели свежести или проверки amoCRM.
