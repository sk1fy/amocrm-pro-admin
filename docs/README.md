# Документация

Этапы 1–4 завершены. Живые документы описывают текущее приложение;
планируемое — только в `plan/`. Исторические планы, reviews и ADR не
удаляются: на них ссылаются отчёты приёмки.

## С чего начать

| Кому | Читать |
| --- | --- |
| Агент перед работой | [AGENTS.md](../AGENTS.md), [STYLE_GUIDE.md](STYLE_GUIDE.md), [plan/README.md](plan/README.md) |
| Ближайшая работа | [connection-state-freshness.md](plan/connection-state-freshness.md) |
| Локальный запуск | [local-run.md](runbooks/local-run.md) |
| Эксплуатация | [operator.md](runbooks/operator.md) |

## Состав `docs/`

| Каталог | Что здесь | Удалять |
| --- | --- | --- |
| [design/](design/architecture.md) | Текущая архитектура, экраны, состояния, источники, роли, API, схема БД, адаптер | нет, обновлять |
| [adr/](adr/README.md) | Принятые решения | нет; не править задним числом |
| [plan/](plan/README.md) | Активные patch-планы и исторические этапы 1–4 | этапы не удалять |
| [runbooks/](runbooks/local-run.md) | Запуск, оператор, новый модуль; `demo-stage-N.md` — сценарии приёмки | нет |
| [reviews/](reviews/docs-audit-2026-09-19.md) | Датированные проверки | нет |

Правило стайл-гайда: не описывать нереализованное как сделанное и
наоборот. Планируемое — в `plan/`, сделанное — в `design/` и runbooks.

Последний аудит этой папки:
[docs-audit-2026-09-19.md](reviews/docs-audit-2026-09-19.md).
