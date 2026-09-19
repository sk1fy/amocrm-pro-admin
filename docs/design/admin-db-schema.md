# Схема собственной БД админки

PostgreSQL 17, база `admin`. Хранит только то, чем владеет админка:
сотрудники, сессии, аудит действий сотрудников, операции, сохранённые
представления. Данных Core/Activity/CRM Events здесь нет и не будет —
они читаются через адаптеры.

Формат миграций и мигратор — [ADR-0005](../adr/0005-admin-db-migrations.md).
Ниже — схема миграций `000001`–`000006`. SQL в этом документе должен
совпадать с `backend/migrations`; при расхождении источник истины —
файлы миграций.

## Общие соглашения

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` для сущностей,
  `BIGSERIAL` для журналов.
- `created_at`/`updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`; триггер
  `set_updated_at()` (как в Core).
- Перечисления — `TEXT` с `CHECK (… IN (…))`, не `ENUM`: проще эволюция.
- Секреты — только хеши. Пароль: argon2id в PHC-строке; токен сессии:
  `SHA-256` bytea(32).
- Все внешние ключи явные; каскад — только для сессий сотрудника.

## 000001_employees

```sql
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

CREATE TABLE employees (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL,
    password_hash TEXT,                       -- NULL допустим для будущего SSO
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT employees_email_key UNIQUE (email),
    CONSTRAINT employees_email_lower CHECK (email = lower(btrim(email)) AND email <> ''),
    CONSTRAINT employees_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT employees_role_check CHECK (role IN ('viewer', 'operator', 'admin')),
    CONSTRAINT employees_status_check CHECK (status IN ('active', 'disabled'))
);
CREATE TRIGGER employees_set_updated_at BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

`status = 'disabled'` — блокировка: вход запрещён, все сессии отзываются.
Удаление сотрудников не предусмотрено: аудит ссылается на `employee_id`.

## 000002_sessions

```sql
CREATE TABLE sessions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    token_hash   BYTEA NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,          -- абсолютный срок
    revoked_at   TIMESTAMPTZ,
    revoke_reason TEXT,                          -- logout | admin | role_change | disabled | expired
    ip           INET,
    user_agent   TEXT,
    CONSTRAINT sessions_token_hash_key UNIQUE (token_hash),
    CONSTRAINT sessions_token_hash_len CHECK (octet_length(token_hash) = 32),
    CONSTRAINT sessions_expires_after_created CHECK (expires_at > created_at),
    CONSTRAINT sessions_revoke_pair CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);
CREATE INDEX sessions_employee_active_idx ON sessions (employee_id, last_seen_at DESC)
    WHERE revoked_at IS NULL;
CREATE INDEX sessions_cleanup_idx ON sessions (expires_at)
    WHERE revoked_at IS NULL;
```

Простой (`SESSION_IDLE_TTL`) проверяется по `last_seen_at` в коде;
`last_seen_at` обновляется не чаще раза в минуту, чтобы не писать на каждый
запрос. Очистка — по политике [Retention и объём](#retention-и-объём-000006_retention_indexes).

## 000003_admin_audit_log

```sql
CREATE TABLE admin_audit_log (
    id            BIGSERIAL PRIMARY KEY,
    employee_id   UUID REFERENCES employees(id),   -- NULL для неуспешного входа
    actor_email   TEXT,                            -- снимок на момент действия
    action        TEXT NOT NULL,                   -- auth.login, auth.login_failed, employee.create, ...
    object_type   TEXT,                            -- employee | session | account | connection | integration | operation
    object_ref    TEXT,                            -- "core:<installation_id>", "employee:<uuid>", "account:<id>"
    outcome       TEXT NOT NULL DEFAULT 'ok',      -- ok | denied | failed
    request_id    UUID,
    ip            INET,
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT admin_audit_action_not_blank CHECK (btrim(action) <> ''),
    CONSTRAINT admin_audit_outcome_check CHECK (outcome IN ('ok', 'denied', 'failed')),
    CONSTRAINT admin_audit_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX admin_audit_employee_created_idx ON admin_audit_log (employee_id, created_at DESC);
CREATE INDEX admin_audit_action_created_idx ON admin_audit_log (action, created_at DESC);
CREATE INDEX admin_audit_object_created_idx ON admin_audit_log (object_type, object_ref, created_at DESC);
```

`metadata` — безопасный список изменённых полей (`{"changed": ["role"],
"from": {"role": "viewer"}, "to": {"role": "operator"}}`); пароли, токены,
секреты интеграций в metadata запрещены (проверка в `audit` пакете по списку
запрещённых ключей). Записи `auth.login_failed` содержат только `actor_email`
и `ip`.

## 000004_operations

```sql
CREATE TABLE operations (
    id              UUID PRIMARY KEY,
    employee_id     UUID NOT NULL REFERENCES employees(id),
    actor_email     TEXT NOT NULL,
    request_id      UUID NOT NULL,
    changed_fields  JSONB NOT NULL DEFAULT '[]'
                    CHECK (jsonb_typeof(changed_fields) = 'array'),
    backend         TEXT NOT NULL,
    target_type     TEXT NOT NULL
                    CHECK (target_type IN
                    ('installation', 'integration', 'job', 'delivery')),
    target_id       TEXT NOT NULL,
    command         TEXT NOT NULL,
    idempotency_key TEXT NOT NULL
                    CHECK (length(idempotency_key) BETWEEN 1 AND 128),
    request_hash    BYTEA NOT NULL CHECK (octet_length(request_hash) = 32),
    state           TEXT NOT NULL
                    CHECK (state IN ('accepted', 'pending', 'running',
                    'succeeded', 'failed', 'partial', 'unknown_outcome')),
    outcome         TEXT NOT NULL DEFAULT '',
    result          JSONB NOT NULL DEFAULT '{}'
                    CHECK (jsonb_typeof(result) = 'object'),
    error           JSONB,
    lease_until     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    finished_at     TIMESTAMPTZ,
    observed_at     TIMESTAMPTZ,
    UNIQUE (backend, target_type, target_id, command, idempotency_key)
);
CREATE UNIQUE INDEX operations_active_target
    ON operations (backend, target_type, target_id)
    WHERE state IN ('accepted', 'running', 'pending');
CREATE INDEX operations_created_id ON operations (created_at DESC, id DESC);
CREATE INDEX operations_target_created
    ON operations (backend, target_type, target_id, created_at DESC, id DESC);
CREATE INDEX operations_state_created
    ON operations (state, created_at DESC, id DESC);
CREATE INDEX operations_request_key
    ON operations (idempotency_key, created_at DESC, id DESC);
CREATE TRIGGER operations_updated_at BEFORE UPDATE ON operations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Повтор с тем же ключом и другим `request_hash` → `conflict`. Ключ общий
для всех сотрудников: два оператора с одним ключом получают одну
операцию. Одновременно активна не более одной операции на
`(backend, target_type, target_id)`.

## 000005_saved_views

```sql
CREATE TABLE saved_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_employee_id UUID REFERENCES employees(id), -- NULL = общее
    section TEXT NOT NULL,
    name TEXT NOT NULL,
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    columns JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    CONSTRAINT saved_views_section_check
        CHECK (section IN ('accounts', 'operations', 'stats')),
    CONSTRAINT saved_views_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT saved_views_params_object CHECK (jsonb_typeof(params) = 'object'),
    CONSTRAINT saved_views_columns_array CHECK (jsonb_typeof(columns) = 'array')
);
CREATE INDEX saved_views_owner_section_idx
    ON saved_views (owner_employee_id, section);
CREATE INDEX saved_views_shared_section_idx
    ON saved_views (section) WHERE owner_employee_id IS NULL;
CREATE UNIQUE INDEX saved_views_owner_section_name_key
    ON saved_views (owner_employee_id, section, name)
    WHERE owner_employee_id IS NOT NULL;
CREATE UNIQUE INDEX saved_views_shared_section_name_key
    ON saved_views (section, name)
    WHERE owner_employee_id IS NULL;
CREATE TRIGGER saved_views_updated_at
    BEFORE UPDATE ON saved_views
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Уникальность личных: `(owner_employee_id, section, name)` где owner
задан; общих: `(section, name)` где owner IS NULL. `stats_snapshots` не
добавлялись: живой запрос Core — источник (ADR-0010).

## Retention и объём (000006_retention_indexes)

Политика хранения — [ADR-0014](../adr/0014-admin-db-retention.md).
Управляемое удаление выполняет только `admin-cli prune` из внешнего
cron; Admin API сам лишь помечает и удаляет сессии по тому же
предикату при фоновой очистке.

| Таблица | Срок | Предикат удаления |
| --- | --- | --- |
| `admin_audit_log` | 365 суток | `created_at < $1` |
| `operations` | 180 суток | `updated_at < $1`, терминальный state |
| `sessions` | 30 суток | revoked/expired раньше `$1` |

Индексы (миграция в скобках):

- `admin_audit_created_id_idx (created_at DESC, id DESC)` (000003);
- `operations_terminal_updated_idx (updated_at) WHERE state IN
  ('succeeded','failed','partial','unknown_outcome')` (000006);
- `sessions_cleanup_idx (expires_at) WHERE revoked_at IS NULL` (000002).

Терминальные состояния операций: `succeeded`, `failed`, `partial`,
`unknown_outcome`. Незавершённые (`accepted`, `pending`, `running`) не
удаляются никогда. Аудит не зависит от наличия сотрудника: его строки
самостоятельны. Миграция `000006_retention_indexes` добавляет только
частичный индекс операций: ведущая колонка `created_at` в
`admin_audit_log` уже есть, а `operations_state_created` не покрывает
фильтр по `updated_at`.

Команда по умолчанию работает в dry-run и только печатает счётчики;
удаление включается `--confirm`:

```sh
admin-cli prune --audit-before 2025-09-13 --operations-before 2026-03-13
admin-cli prune --sessions-before 2026-08-14 --confirm
```

Оценка объёма на год и допущения — в ADR-0014; фактические числа
обязаны быть перемерены на пилотных данных.

## Роли PostgreSQL

Как в Core: `admin_owner` (миграции, DDL) и `admin_runtime` (только DML
собственных таблиц). Runtime отклоняет запуск под owner-ролью вне
`APP_ENV=development`. В development compose допустим один пользователь.

## Резервное копирование

`pg_dump --format=custom` базы `admin`; проверка restore в новую БД
с прогоном миграций и входом сотрудника. Порядок —
[operator.md](../runbooks/operator.md).
