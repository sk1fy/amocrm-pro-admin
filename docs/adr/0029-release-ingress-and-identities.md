# ADR-0029. Единственный TLS ingress и точные образы выпуска

## Контекст

Два рабочих интерфейса используют разные browser audience одного Admin
API. Старый production overlay публиковал API отдельно и наследовал
локальные образы CLI и миграций. Это допускало несовместимые компоненты
и обход единственного доверенного прокси. Решение продолжает
[ADR-0028](0028-frontend-build-purpose.md).

## Решение

Самостоятельный `deploy/docker-compose.release.yml` заменяет production
наследование dev-файла. Только ingress публикует TLS порт на loopback.
Frontend, API, management и БД не имеют опубликованных портов. БД и web
используют внутренние сети. API подключён к внешним сетям Core и Platform
и обычной bridge-сети для исходящих соединений. Наличие egress не является
сетевой политикой ограничения адресатов.

Образ ingress содержит проверяемый шаблон nginx. При запуске он принимает
два точных HTTPS DNS origin без path, query или fragment. Hostname различны.
Host и SNI проверяются вместе без учёта регистра. Разрешён только порт
origin. Для стандартного HTTPS допустимы Host без порта и с `:443`.
Неизвестный SNI отвергается при handshake, несовпадение Host отвечает 421.
HTTP listener отсутствует. `/api/` идёт прямо в API с исходным проверенным
Host. Ingress перезаписывает IP, XFF и proto, очищает Forwarded и
X-Forwarded-Host. Других доверенных прокси перед ним нет.

TLS certificate и key, BFF CA и client keypair монтируются отдельными
read-only файлами. Compose не создаёт отсутствующие пути. Обязательные
release-параметры не имеют локальных значений по умолчанию.
Production config включает `RejectFixtureBackends`, catalog отклоняет
fixture-kind централизованно при загрузке. Development сохраняет fixtures.

Manifest сопоставляет immutable image references и Docker image IDs,
полную Git revision, purpose labels, два origin и migration head 000011.
`verify-release.py` проверяет выбранные локальные образы. Labels являются
метаданными сборки. Проверка не доказывает происхождение бинаря и не
заменяет acceptance. У Admin API нет команды `--version`.

Минимальный совместимый backend для отката имеет revision `495cead`.
Pre-A07 binary игнорирует `technical_access=false`. Все старые Admin
процессы останавливаются до открытия приглашений. Схема 000011,
identities, grants и история сохраняются при откате.

## Отклонённые варианты

Overlay с наследованием dev defaults сохраняет возможность выпуска
локального CLI или fixture registry. Дополнительный proxy hop через
frontend ломает единственную границу доверия IP. Сетевой startup probe
Platform связывает работоспособность Core и Staff с внешней зависимостью.

## Последствия

Оператор перед запуском сверяет manifest с resolved Compose. Политика
Host и nginx проверяется постоянной Docker-проверкой `release-config-check`.
Полная browser HTTPS acceptance остаётся отдельной единицей
[плана A08](../plan/manager-release-v1.md).

Невалидные локальные mTLS файлы останавливают API. Корректный чужой CA,
удалённый неверный SAN и недоступность Platform дают явную деградацию
при запросе. Никакого сетевого startup probe не добавляется.
