# ADR-0001: Отдельный Admin API и admin read listener в Core

Статус: принято. Дата: 2026-09-12.

## Контекст

Нужна админка для сотрудников поверх `amocrm-pro` (Go, PostgreSQL 17, отдельные
`api`/`worker`, Activity и CRM Events с собственными логическими БД). В Core уже
есть операторский CLI `cmd/integrations`, `cmd/activity-control`, management
listener с `/live`, `/ready`, `/metrics`, `/components`, а также management
token для панелей Activity. Персонального входа сотрудников и HTTP-чтения
установок нет.

Рассматривались варианты:

1. Админка читает Core PostgreSQL напрямую через read-only роль.
2. Новый отдельный процесс `cmd/admin` в amocrm-pro.
3. Дополнительный listener в существующем `cmd/api` + отдельный Admin API в
   собственном репозитории.

## Решение

Вариант 3.

- В `amocrm-pro` появляется пакет `internal/adminread` (этап 1) и позже
  `internal/admincommand` (этап 2), обслуживаемые отдельным listener
  `ADMIN_HTTP_ADDRESS` процесса `api`, защищённым service token
  `ADMIN_API_TOKEN`. Listener не стартует без обеих переменных.
- В `amocrm-pro-admin` живёт Admin API (Go) с собственной PostgreSQL для
  сотрудников, сессий и аудита, и frontend. Admin API обращается к Core только
  через listener.

## Почему не вариант 1

Прямое чтение нарушает владение данными (ADR-0010/0012 в amocrm-pro), связывает
админку со схемой Core и не покрывает этап 2, где нужны прикладные сервисы
(`integrations.Store`, `activitybridge.SetPilot`, `RetryDelivery`). Читать
напрямую, а писать через сервисы означало бы два разных пути к одним данным.

## Почему не вариант 2

Третий deployment unit требует отдельного ADR в amocrm-pro (ADR-0002 там
фиксирует два бинарника), нового image target, healthcheck и compose. Listener в
`api` переиспользует уже собранные pool, keyring и `componentruntime` (доступ к
портам Activity). Если admin-трафик начнёт мешать публичному API, выделение в
отдельный процесс останется возможным без смены контракта: пакет не зависит от
`cmd/api`.

## Последствия

- Контракт `api/admin-openapi.yaml` версионируется отдельно от публичного
  `openapi.yaml`; маршруты — в `apicontract.AdminRoutes`.
- Actor для аудита Core приходит из заголовка `X-Admin-Actor`, который
  формирует Admin API из проверенной сессии сотрудника. Core не аутентифицирует
  сотрудников и не хранит их.
- Токен listener — служебный credential; ротация описывается в инструкции
  оператора (этап 4). До этого — env в compose.
- Отказ listener виден в админке как `unavailable` для источника `core`, а не
  как общая ошибка.
