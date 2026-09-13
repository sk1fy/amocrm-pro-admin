# ADR-0013: Метрики Prometheus Admin API

Статус: принято, 2026-09-13.

## Контекст

Этап 4 требует наблюдаемости Admin API. Management listener уже
отдаёт `/live` и `/ready`; `/metrics` упомянут в `.env.example`,
но не реализован, зависимости Prometheus в Admin API нет.
Метрики нужны по HTTP (маршрут, метод, статус) и по бекендам
(доступность, канонический исход, время последнего ответа).
Идентификаторы аккаунтов, установок, сотрудников, job, сессий,
email, домены и request id запрещены в labels Prometheus
([STYLE_GUIDE](../STYLE_GUIDE.md), разделы 9 и 14).

## Решение

1. Новый пакет `backend/internal/platform/metrics` с собственным
   `prometheus.NewRegistry()`. Default registry не используется:
   endpoint отдаёт только объявленные семейства, чужие библиотеки
   не могут добавить свои метрики.
2. Единственная новая зависимость —
   `github.com/prometheus/client_golang` (v1.23.2) и её косвенные
   модули. Отдача — `promhttp.HandlerFor` с нашим registry.
3. Семейства:
   `admin_http_requests_total{route,method,status}`;
   `admin_http_request_duration_seconds{route,method}` (бакеты по
   умолчанию);
   `admin_backend_probes_total{backend,outcome}` (только фактические
   health-пробы, TTL-кеш счётчик не увеличивает);
   `admin_backend_up{backend}` (1 — available, 0 — иначе);
   `admin_backend_last_response_timestamp_seconds{backend}`
   (только при наличии успешного ответа).
4. Политика labels — только конечные значения. `route` — шаблон
   chi (`unmatched` для несовпавшего); `method` — HTTP-метод из
   фиксированного набора (`other` иначе); `status` — числовой код;
   `backend` — код реестра из `deploy/backends.yaml`; `outcome` —
   закрытый набор: `available`, `backend_unavailable`,
   `backend_timeout`, `capability_unavailable`, `unknown`.
   Запрещены в labels: UUID аккаунтов, установок, сотрудников,
   job и сессий, email, домены, request id и любые пути с
   конкретными идентификаторами.
5. `/metrics` смонтирован на management listener (`/live`,
   `/ready`) без аутентификации: listener слушает только
   loopback/внутреннюю сеть (раздел 9 стайл-гайда), публичный API
   остаётся на отдельном порту. Middleware `HTTPMiddleware` стоит
   на публичном роутере после `httpx.RequestID` и до
   аутентификации, статус снимает обёртка ResponseWriter.
6. `ObserveBackendProbe` вызывается из `catalog.Registry.probe`
   только после фактического вызова `Health`:
   `admin_backend_probes_total` считает реальные health-пробы и не
   растёт на TTL-кеш, а `admin_backend_up` и
   `admin_backend_last_response_timestamp_seconds` хранят последнее
   известное состояние: обновляются результатом пробы и не
   сбрасываются кеш-чтением. При появлении фонового пробера вызов
   переедет в него без смены имён семейств.
7. Grafana/Loki не покрываются: на экране Система остаются только
   ссылки из env `GRAFANA_BASE_URL` / `LOKI_BASE_URL`. Дашборды,
   правила алертов и приём метрик — вне объёма этапа.

## Отклонённые варианты

- Default registry Prometheus: состав `/metrics` становится
  неявным, а сторонние зависимости могут добавить свои семейства.
- Отдельный listener под `/metrics`: management listener уже
  изолирован в loopback; новый порт и конфигурация не нужны.
- Аутентификация на `/metrics`: Prometheus-скрейпер не проходит
  сессию Admin API; защита обеспечивается сетью, как у `/live` и
  `/ready`.
- labels с ID аккаунта/установки для drill-down: неограниченная
  кардинальность и утечка идентификаторов.
- Собственный экспортёр формата Prometheus: дублирование
  `client_golang` без выгоды.

## Последствия

Метрики доступны только из внутренней сети и не содержат
пользовательских идентификаторов. В образ Admin API добавлена
зависимость `prometheus/client_golang`. Unit- и integration-тесты
проверяют endpoint, конечность labels и исходы проб. Дашборды и
алерты появятся отдельным этапом.
