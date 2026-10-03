# РС-10 — контроль пилота из Admin

Локальная подготовка; реальный пилот и переключение `rakurs-ssd` не выполнены.
Канонические материалы владельца Core:
[матрица 16 сценариев](../../../amocrm-pro/docs/specs/lead-distribution-v1/11-local-acceptance.md),
[пилот, наблюдение, backup и остановка](../../../amocrm-pro/docs/runbooks/lead-distribution-pilot.md),
[G1–G6](../../../amocrm-pro/docs/specs/lead-distribution-v1/03-pilot-and-acceptance.md).

## Перед включением

1. Выбрать точные account/pipeline/stage/group и согласованные версии всех пяти проектов.
   Проверить migrations, scoped grants/mappings, приватный транспорт и текущие роли.
2. В Admin открыть [диагностику](lead-distribution.md), сверить источник, observed_at,
   OAuth, состав webhook events и outboxes. Активная подписка сама по себе не доказывает
   покрытие всех событий. Core grant не означает доступность TeamOS; Team queue unknown.
3. В TeamOS/виджете настроить observe и графики. Журнал содержит предварительные решения;
   актуальный CRM owner, исторический owner и кандидат различаются. Admin не знает Team rule
   executionMode и не выдаёт свою паузу за переключение live/observe.
4. Сохранить двухсторонний согласованный backup, список in-flight/unknown и exact IDs.
   Устранить прежних writers выбранной области и выяснить их уже отправленные эффекты.
   Проверить G1–G6 и получить отдельное разрешение на настоящий live gate.

## Stop и восстановление

Admin pause закрывает новые Core admissions/dispatch, но не удаляет Team queue,
read, outboxes, guards и неизвестные эффекты. Дополнительно pause нужных Team rules
производится владельцем Team. 202 — квитанция команды; наблюдать отдельно receipt
и настоящий результат назначения. Повтор blocked delivery использует frozen message_id
и CAS attempts. Reconcile выполняет свежий GET без нового PATCH.

При неизвестном результате сохранить exact operation/request ID. Отсутствие operation
при 404 недоступного Core не даёт права создать replacement intent или удалить claims;
истёкший неподтверждённый intent требует разбора владельцем. После двухстороннего restore
сначала сверить CRM и неизвестные эффекты, затем разрешать новые записи.
Смена observe → live не исполняет прошлые наблюдения; обычная pause/resume сохраняет
ранее принятую рабочую очередь. Откат приложения и ZIP требует совместимых версий;
destructive migration down не является способом очистить историю.

## Следующие окружения

- Сервер + CRM fixture: две отдельные owner DB, HTTPS/private ingress, реальные процессы,
  рестарты, роли/идемпотентность, timeout и согласованный backup/restore.
- Рекомендуется тестовый сервер + отдельный amoCRM аккаунт: домен, интеграция, pinned ZIP,
  2–3 сотрудника и искусственные сделки; OAuth/re-OAuth, настоящий SDK/JWT/CORS, webhook,
  фактический owner и общие настройки обоих UI. Затем G1–G6 и ограниченный пилот.
- Локальные сервисы + тестовый аккаунт через HTTPS tunnel: быстрее подготовка, ноутбук
  постоянно доступен; наружу только callbacks/assets/widget API. Admin и private bridge закрыты.

РС-03.1.2 и РС-08.3.2 остаются живыми зависимостями. Локальные paired тесты используют
настоящие Core/Team HTTP и две PostgreSQL, но CRM и SDK токен синтетические.
Frontend browser проверки также используют fixtures. Секреты — только через защищённое
окружение сервера, не в задачах, ZIP или чатах. Сам Admin код в РС-10 не менялся;
его полные локальные проверки выполнены в РС-09, здесь проверяются документационные ссылки.
