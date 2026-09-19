# Демонстрация этапа 4

Актуальный сквозной сценарий экранов после этапов 1–4: реестр бекендов,
подписки, частичная доступность, метрики и эксплуатация. Стек
development/e2e, не применять к production.
Эксплуатационные процедуры — [operator.md](operator.md), локальный
стек — [local-run.md](local-run.md).

## Предпосылки

- Dev-стек: `make up` — admin-postgres, мигратор, admin-api, frontend
  (`http://127.0.0.1:5173`). Бекенды в `deploy/backends.yaml`: `core`
  (`kind: core-http`, пилот Core) и `fixture` (`kind: fixture`,
  `profile: module`, тестовые данные). Вход — [local-run.md](local-run.md).
- Детерминированные fixture-подписки даёт `core` с `profile: demo`:
  fixture-стек пути A из [demo-stage-1.md](demo-stage-1.md) или
  `make e2e` (`http://127.0.0.1:5174`). В dev-стеке `core-http` не
  объявляет возможность `subscriptions`, поэтому на шаге 2 блок
  «Подписка» покажет то же «Данные подписки недоступны», что и на
  шаге 3, — ожидаемое поведение без источника, а не сбой.
- Пилот Core (`make activity-up` в `../amocrm-pro`) нужен для шага 5;
  без пилота `core` сразу `unavailable`, а fixture-данные читаются.
- Пилот наполняется SQL-fixture с `settings.origin = "fixture"`
  (local-run.md) — такие данные помечены `fixture`, как и адаптерные.
- Ссылки Grafana/Loki не обязательны: без `GRAFANA_BASE_URL` и
  `LOKI_BASE_URL` их в интерфейсе нет.

## Сценарий

1. **Реестр бекендов.** Открыть `/system`, таблица «Реестр бекендов»:
   две строки — `core` и `fixture`. Сверить тип адаптера
   (`core-http`/`fixture`), состояние, контракт `v1`, ревизию,
   возможности адаптера, время последнего ответа и последней проверки.
   У `fixture` возможностей меньше: только чтение (`accounts`,
   `connections`, `integrations`, `audit`). Если пилот остановлен,
   `core` — «Недоступен», в «Ошибке» безопасный код
   (`backend_unavailable`/`backend_timeout`), а «Последний ответ»
   хранит время последнего успеха. Ссылки Grafana/Loki видны, только
   если заданы env.
2. **Подписка «Профи».** fixture-стек: `/accounts/91000001`. Блок
   «Подписка»: тариф «Профи», бейдж «Активна», срок действия
   (fixture: +30 суток от 2026-09-12), возможности
   `lead-status, activity`, источник `core` и `observed_at`. В dev-стеке
   с `core-http` здесь «Данные подписки недоступны» (см. шаг 3).
3. **Нет данных ≠ «нет подписки».** `/accounts/91000004` (удалённая
   установка): «Данные подписки недоступны» без ошибки и без отказа
   страницы. Это отсутствие факта, а не «нет подписки».
4. **Два бекенда на одном аккаунте.** `/accounts/91000002`: карточки
   подключений обоих бекендов — `core`
   `f1a00000-0000-4000-8000-000000000003` (reauth) и
   `…0004` (active), `fixture`
   `f2a00000-0000-4000-8000-000000000003`. У карточек виден источник
   и `observed_at`; в карточке подключения — «Происхождение:
   fixture». Открыть
   `/accounts/91000002/widgets/fixture/f2a00000-0000-4000-8000-000000000003`:
   ссылки «Настройки Activity и lead-status» нет, а страница
   `…/settings` показывает «Для этого модуля настройки недоступны»
   (у модуля нет возможности `settings`, продукт `fixture-module` не
   зарегистрирован в activity-наборе).
5. **Частичная доступность.** В `../amocrm-pro` остановить API пилота:
   `docker compose -f docker-compose.activity.yml stop api`. Обновить
   `/system` через ~10 с (кеш проб): `core` — «Недоступен», ошибка
   безопасна. `/accounts/91000002` по-прежнему показывает подключение
   `fixture`, поиск аккаунта работает. Альтернатива: убрать блок
   `core` из `deploy/backends.yaml` и перезапустить admin-api — тогда
   источник исчезает совсем (в `sources` его нет); fixture-данные
   остаются. Вернуть: `docker compose -f docker-compose.activity.yml
   up -d api` (или вернуть блок и перезапустить admin-api).
6. **Метрики.** Management listener — только loopback:

   ```sh
   curl -s http://127.0.0.1:8092/metrics | grep '^admin_' | head
   ```

   Ожидаемые семейства (примеры меток):

   ```text
   admin_backend_up{backend="core"} 1
   admin_backend_probes_total{backend="fixture",outcome="available"} 3
   admin_backend_last_response_timestamp_seconds{backend="fixture"} ...
   admin_http_requests_total{route="/api/v1/me",method="GET",status="200"} 12
   ```

   В labels нет и не должно быть ID аккаунтов/подключений/сотрудников,
   job, сессий, email, доменов и request id
   ([ADR-0013](../adr/0013-admin-metrics.md)).
7. **Retention и backup.** Сначала dry-run prune (ничего не удаляет):

   ```sh
   docker compose -f deploy/docker-compose.yml --profile tools run \
     --rm -T admin-cli prune --audit-before 2025-09-13
   ```

   Бэкап и проверка restore:

   ```sh
   make backup-db
   make restore-check RESTORE_CONFIRM=restore-check
   ```

   Полные процедуры, `--confirm`, расписание и ротация — только
   [operator.md](operator.md), разделы 12–13; здесь они не
   дублируются.
8. **Автопрогон.** `make e2e` поднимает fixture-стек
   (`http://127.0.0.1:5174`) и выполняет Playwright-сценарии, включая
   `frontend/e2e/stage-4.spec.ts`:
   - реестр бекендов: продукты, возможности адаптера и бекенда,
     компоненты;
   - подписка «Профи» с источником и отдельно отсутствие факта;
   - слияние подключений двух бекендов на одном аккаунте;
   - настройки модуля: недоступны без capability `settings`, доступны
     для Activity;
   - роли, отзыв сессий и аудит.

## Происхождение данных

| Источник | Данные | Метка |
| --- | --- | --- |
| fixture `core`, `profile: demo` | 91000001–91000006, подписки | `fixture` |
| fixture `module` | 92000001, 92000002, 91000002 | `fixture` |
| `core-http` (пилот) | реальные + SQL-fixture | `real`/`fixture` |

Метка `fixture` обязана быть видимой; смешивать её с реальными данными
без пометки запрещено ([states.md](../design/states.md),
[data-sources.md](../design/data-sources.md)).
