CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

CREATE TABLE employees (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL,
    password_hash TEXT,
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
