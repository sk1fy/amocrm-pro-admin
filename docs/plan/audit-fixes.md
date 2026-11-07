# Исправления по аудиту 2026-11-07

## Объём

Сверено с `main` `644a3e5` и Core `6f89ed9` (`main`). Core не меняется;
миграций admin DB нет. Исправляются подтверждённые находки аудита:

1. `unknown_outcome` без квитанции Core переписывался каждым опросом
   reconciler, GET операции и карточки подключения: `finished_at` и
   `updated_at` сдвигались, retention не удалял строку. Ответ Core 403
   на команду сохранялся как `unknown_outcome`, хотя квитанции нет.
2. Сбой admin DB при чтении сотрудника давал 401 (выход из интерфейса),
   403 на команду и `failed/forbidden` операции у сотрудника с правом.
3. Слияние списков нескольких бекендов (аккаунты, скан с фильтрами,
   виджеты, глобальные jobs) перезапускало исчерпанный источник с первой
   страницы, а недоступный источник терял позицию.
4. Core `main` не отдаёт `authorization_check`; фильтр «Проверка»
   ok/stale/failed с таким Core молча возвращал пустой список.
5. При `TRUST_PROXY_HEADERS=true` IP брался из левого значения
   `X-Forwarded-For`, которое задаёт клиент; email при входе не был
   ограничен по длине и целиком попадал в аудит и ключ лимитера.

Решения: [ADR-0022](../adr/0022-rightmost-forwarded-address.md) для
пункта 5; остальное — исправления в рамках ADR-0008, ADR-0009,
ADR-0016, ADR-0017.

Вне объёма (найдено аудитом, отложено): логирование причин 500
в `httpapi`, транзакция доступа и аудита в `admin-cli`, 400 для
некорректного `connection_id`, проверка UUID в путях к Core, бюджет
времени preflight команд распределения, курсор `stats/accounts`
(сейчас stats объявляет только Core), слияние ветки Core
`feature/admin-connection-state-freshness`.

## Приёмка

- [x] Повторный опрос `unknown_outcome` не меняет строку и аудит;
  операция попадает под retention. Core 403 → `failed`,
  `permission_denied`.
- [x] Сбой чтения сотрудника → 500 в `rbac.Require`, `/me` и приёме
  команды; до dispatch — `failed`, `backend_unavailable`.
- [x] Курсор отмечает исчерпанные источники (`!end`), сохраняет позицию
  недоступного; старый формат читается. Тест на двух бекендах без
  повторов строк.
- [x] Источник без `authorization_check` при фильтре ok/stale/failed —
  `unavailable`, `capability_unavailable`.
- [x] Правое значение `X-Forwarded-For`; email ≤ 254 символов с тем же
  ответом; runbook требует перезапись заголовка прокси.
- [x] `make check` зелёный (см. отчёт).

## Отчёт

Дата: 2026-11-07. Коммиты: amocrm-pro-admin — ветка
`feature/audit-fixes` от `644a3e5`; amocrm-pro `6f89ed9` (без изменений).

### Реализованные экраны и операции
- Операции: повторный опрос `unknown_outcome` без квитанции не
  переписывает строку; Core 403 → `failed`/`permission_denied`.
- Права: сбой admin DB при чтении сотрудника → 500 (`rbac.Require`,
  `/me`, приём команды) и `backend_unavailable` у операции до dispatch.
- Списки нескольких бекендов: курсор с меткой исчерпанного источника
  и позицией недоступного; скан с фильтрами больше не читает
  исчерпанный источник повторно.
- Фильтр «Проверка» с Core без `authorization_check` — источник
  `unavailable`/`capability_unavailable`.
- IP клиента — правое значение `X-Forwarded-For`; email входа и
  создания сотрудника ≤ 254 символов.

### Изменения контрактов и миграции
- Admin API: внутренний формат `next_cursor` списков (непрозрачен для
  клиента, старый читается); `POST /system/employees` отвечает 400 на
  email длиннее 254 символов; 500 вместо 401/403 при сбое admin DB.
- Core admin: нет.
- Миграции admin DB: нет; Core: нет.

### Результаты проверок
| Команда | Репозиторий | Результат |
| --- | --- | --- |
| make docs-check, lint | amocrm-pro-admin | ok, golangci-lint 0 issues |
| make test | amocrm-pro-admin | Go ok; Vitest 183 ok |
| make integration-test | amocrm-pro-admin | 7 пакетов ok (см. ограничения) |
| make e2e | amocrm-pro-admin | 44 сценария ok |
| make scripts-test, vulncheck | amocrm-pro-admin | ok; уязвимостей в вызываемом коде нет |

### Инструкция запуска и демонстрационный сценарий
- docs/runbooks/local-run.md; прокси — docs/runbooks/operator.md.

### Происхождение данных демонстрации
- fixture: тесты на `fixture.Demo` и `fixture.Module`.

### Ограничения и зависимости следующего этапа
- В первом прогоне `make check` упал
  `TestHTTPCommandAdmissionPersistenceAndPermissions`: вход не вернул
  cookie. Повторный `make integration-test` — все пакеты ok. Похоже
  на нестабильность входа под нагрузкой `-race` (таймаут сервиса 2 с
  включает хеширование пароля); причина не подтверждена.
- Фильтр «Проверка» полностью работает только после слияния ветки Core
  `feature/admin-connection-state-freshness`.
- Отложенные пункты — в разделе «Объём».
