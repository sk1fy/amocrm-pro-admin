# ADR-0010: Activity, lead-status и статистика этапа 3

Статус: принято, 2026-09-13.

## Контекст

Этап 2 дал durable operations и команды Core. Этап 3 требует
настроек/синка/панелей Activity, правил lead-status и сводной
аналитики. Порты Activity требуют `serviceapi.Auth`; решение
принципала — в Core [ADR-0028](https://github.com/sk1fy/amocrm-pro/blob/dd2a4a5b3baa8d64ba678d2b6bf12005d24b1365/docs/adr/0028-admin-activity-principal.md).
`used_widget_tokens` не подходит для «последнего использования»:
это replay JWT без индекса по аккаунту.

## Решение

1. Чтение Activity/lead-status/статистики — новые GET Core admin
   listener. Мутации — существующий `POST /admin/v1/commands` с
   новыми `command` на `target_type=installation` (и `panel` для
   patch/rotate). Admin API оборачивает их в operations, как этап 2.
2. Команды: `activity-configure`, `activity-sync`,
   `activity-panel-create`, `activity-panel-patch`,
   `activity-panel-rotate`, `lead-status-configure`. Права — уже
   объявленные `activity:*` и `leadstatus:rules:write`.
3. Синк: Core принимает в outbox и оставляет receipt `pending`, пока
   CRM Events operation не `succeeded|failed`. HTTP 202 ≠ завершено;
   UI опрашивает `GET /operations/admin/{id}`.
4. Конфликт настроек: `expected_updated_at` из GET; 409 + текущее
   значение, без тихой перезаписи.
5. Статистика: один запрос Admin API / один запрос Core на период
   (`period=24h|7d|30d`). Сводка и детализация — один snapshot
   `observed_at`. Формулы — в `data-sources.md`. Last-use —
   `max(installations.updated_at, jobs.updated_at)` в окне; не
   `used_widget_tokens`.
6. `saved_views` в admin DB: личные и общие (`owner_employee_id`
   NULL). `views:write` у operator+. Grafana/Loki — ссылки из env
   `GRAFANA_BASE_URL` / `LOKI_BASE_URL` с интервалом и id в query,
   не в labels Prometheus. Пустой URL → ссылок нет.

## Отклонённые варианты

- Прямой HTTP Admin API → Activity public ports.
- Отдельный target_type на каждую панель без installation scope.
- Реконструкция истории подключений до включения сбора.

## Последствия

Адаптер включает `Settings` и `Stats`. Fixture Demo покрывает
сценарии без Core. Частичная недоступность Activity даёт
`unavailable` у блока, не у всей карточки.
