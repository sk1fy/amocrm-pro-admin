# ADR-0018 — диагностика распределения

Статус: принято. Дата: 2026-10-03.

## Контекст

Распределение принадлежит TeamOS, CRM эффекты и durable доставка — Core.
Оператору нужна безопасная цепочка назначения и восстановление, даже если
часть инфраструктуры недоступна. DB Core нельзя читать из Admin API.

## Решение

Добавить optional DistributionBackend, typed summary/trace и capability.
Переиспользовать серверные Observation, состояние и actor. Все команды
идут через existing durable admin receipt/idempotency/RBAC/audit.
Сохранить неизвестный результат и запретить слепой повтор назначения.
Для retry использовать явный message_id frozen envelope, отдельно от
составного trace row ID. Core owns CAS предусловий и current scope.

## Отклонённые варианты

Прямое чтение TeamOS/Core DB, вывод сырых payload, фиктивное отсутствие
очереди при ошибке, повтор назначения с новым ключом после таймаута.

## Последствия

Очередь TeamOS честно unknown, её смотрят в TeamOS. Старый Core summary 404
даёт unknown, ошибку маршрута нельзя выдать за нулевые счётчики.
Fixture E2E проверяет интерфейс; installed amoCRM/live OAuth и реальный
аккаунт требуют отдельной тестовой среды. Admin DB миграций нет.
