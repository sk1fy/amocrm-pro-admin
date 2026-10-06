# Документация

Действующие документы описывают реализованное приложение. Код, миграции
и OpenAPI определяют фактическое поведение; ADR — принятые решения.
Локальная проверка и приёмка production учитываются отдельно.

## С чего начать

| Задача | Документ |
| --- | --- |
| Правила работы | [AGENTS.md](../AGENTS.md), [STYLE_GUIDE.md](STYLE_GUIDE.md) |
| Планы и незавершённая внешняя приёмка | [plan/README.md](plan/README.md) |
| Архитектура | [design/architecture.md](design/architecture.md) |
| Локальный запуск | [runbooks/local-run.md](runbooks/local-run.md) |
| Эксплуатация | [runbooks/operator.md](runbooks/operator.md) |
| Архитектурные решения | [adr/README.md](adr/README.md) |

## Контракты и интерфейс

- [HTTP API](design/admin-api.md).
- [Схема БД](design/admin-db-schema.md).
- [Адаптер Core](design/backend-adapter.md).
- [Источники данных](design/data-sources.md).
- [Состояния](design/states.md).
- [Роли](design/roles.md).
- [Экраны](design/screens.md).

## Распределение и внешняя приёмка

- [Диагностика и восстановление](runbooks/lead-distribution.md).
- [Наблюдение, пилот и другие окружения](runbooks/lead-distribution-pilot.md).
- [РС-09](plan/lead-distribution-diagnostics.md).
- [Независимое ревью РС-03–10](plan/lead-distribution-review.md).
- [Синхронизация staging](plan/staging-source-sync.md).

## Поддержка документации

Аудит структуры и локальных ссылок: 06.10.2026. Завершённые планы этапов,
дублирующие patch-планы и промежуточные reviews удалены; доступны в истории
Git. Сохранены инструкции, ADR и документы с внешними условиями приёмки.
Новые инструкции обновлять в design/runbooks; результаты небольших
изменений фиксировать в PR/CI. Новый план создавать для конкретной работы,
а завершённую реализацию не показывать как текущий backlog.

[Нагрузочный отчёт 13.09.2026](reviews/stage-4-load-2026-09-13.md)
сохранён: содержит измерения больших списков и EXPLAIN для `make bench-admin`.
