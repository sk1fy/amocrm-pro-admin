ALTER TABLE employees ADD COLUMN manager_grants_version BIGINT NOT NULL DEFAULT 1
    CHECK (manager_grants_version BETWEEN 1 AND 9007199254740991);

CREATE TABLE manager_command_intents (
    id UUID PRIMARY KEY,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    idempotency_key UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('installation.review', 'installation.crm_deal.retry')),
    target_id UUID NOT NULL,
    expected_version BIGINT NOT NULL CHECK (expected_version BETWEEN 1 AND 9007199254740991),
    body_hash BYTEA NOT NULL CHECK (octet_length(body_hash) = 32),
    next_check_at TIMESTAMPTZ,
    lease_id UUID,
    lease_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((lease_id IS NULL) = (lease_until IS NULL)),
    UNIQUE (employee_id, idempotency_key)
);
CREATE INDEX manager_command_intents_reconcile_idx
    ON manager_command_intents (next_check_at, id) WHERE next_check_at IS NOT NULL;
CREATE TRIGGER manager_command_intents_set_updated_at BEFORE UPDATE ON manager_command_intents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
