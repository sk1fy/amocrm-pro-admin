# Схема собственной БД админки

PostgreSQL 17, база `admin`. Хранит только то, чем владеет админка: сотрудники,
сессии, аудит действий сотрудников, операции (этап 2), сохранённые
представления и агрегаты статистики (этап 3). Данных Core/Activity/CRM Events
здесь нет и не будет — они читаются через адаптеры.

Формат миграций и мигратор — [ADR-0005](../adr/0005-admin-db-migrations.md).
Ниже — целевая схема этапа 1 (миграции `000001`–`000003`) и зарезервированные
таблицы следующих этапов. SQL в этом документе — черновик для миграций; при
расхождении источник истины — файлы `backend/migrations`.

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
запрос. Очистка: `revoked_at` старше 30 суток и истёкшие — порциями.

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

## Зарезервировано: этап 2 — `operations`

```sql
CREATE TABLE operations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id     UUID NOT NULL REFERENCES employees(id),
    backend         TEXT NOT NULL,                 -- код бекенда из backends.yaml
    target_type     TEXT NOT NULL,                 -- connection | integration
    target_id       TEXT NOT NULL,                 -- локальный ID бекенда
    command         TEXT NOT NULL,                 -- check | enable | disable | revoke | uninstall | reconcile | retry | ...
    idempotency_key TEXT NOT NULL,
    request_hash    BYTEA NOT NULL,                -- SHA-256 канонического payload
    state           TEXT NOT NULL DEFAULT 'accepted',
    outcome         JSONB,                         -- безопасный результат бекенда
    error_code      TEXT,
    error_message   TEXT,
    backend_ref     TEXT,                          -- ID операции/job бекенда, если есть
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    CONSTRAINT operations_idempotency_key UNIQUE (backend, target_type, target_id, command, idempotency_key),
    CONSTRAINT operations_state_check CHECK (state IN
        ('accepted', 'pending', 'running', 'succeeded', 'failed', 'partial', 'unknown_outcome')),
    CONSTRAINT operations_request_hash_len CHECK (octet_length(request_hash) = 32)
);
CREATE INDEX operations_target_created_idx ON operations (backend, target_type, target_id, created_at DESC);
CREATE INDEX operations_employee_created_idx ON operations (employee_id, created_at DESC);
CREATE INDEX operations_active_idx ON operations (updated_at) WHERE state IN ('accepted', 'pending', 'running');
```

Повтор с тем же ключом и другим `request_hash` → `conflict`. Ключ общий для
всех сотрудников: два оператора с одним ключом получают одну операцию.

## Зарезервировано: этап 3

- `saved_views(id, owner_employee_id NULL=общее, section, name, params JSONB,
  columns JSONB, created_at, updated_at)`.
- `stats_snapshots(id BIGSERIAL, metric, period_start, period_end, dimensions
  JSONB, value NUMERIC, source, observed_at, created_at)` — агрегаты,
  собираемые с момента включения; история до начала сбора не
  реконструируется.

## Роли PostgreSQL

Как в Core: `admin_owner` (миграции, DDL) и `admin_runtime` (только DML
собственных таблиц). Runtime отклоняет запуск под owner-ролью вне
`APP_ENV=development`. В development compose допустим один пользователь.

## Резервное копирование

`pg_dump --format=custom` базы `admin` (этап 4); проверка restore в новую БД
с прогоном миграций и входом сотрудника.
