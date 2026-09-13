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

Ожидаемые ADR следующих этапов: проверка
подключения через владельца исходящего бюджета и список безопасных повторов
(этап 2), административный контекст авторизации Activity (этап 3, в
`amocrm-pro`).

- [ADR-0008: курсоры истории и операций аккаунта](0008-account-stream-pagination.md).

- [ADR-0009: устойчивые операции и диагностика](0009-durable-admin-operations.md).
- [ADR-0010: Activity, lead-status и статистика этапа 3](0010-stage-3-activity-stats.md).
- [ADR-0011: контракт адаптера бекенда v1](0011-adapter-contract-v1.md).
- [ADR-0012: источник подписок](0012-subscriptions-source.md).
- [ADR-0013: метрики Prometheus Admin API](0013-admin-metrics.md).
- [ADR-0014: retention и объём admin DB](0014-admin-db-retention.md).
