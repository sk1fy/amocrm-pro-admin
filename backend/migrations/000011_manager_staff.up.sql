ALTER TABLE employees ADD COLUMN technical_access BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE employees ADD COLUMN manager_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE employees ADD COLUMN manager_changed_by UUID REFERENCES employees(id) ON DELETE SET NULL;
CREATE INDEX employees_staff_email_id_idx ON employees (email, id);
CREATE TABLE manager_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    expires_at TIMESTAMPTZ NOT NULL,
    created_by UUID NOT NULL REFERENCES employees(id),
    consumed_at TIMESTAMPTZ,
    accepted_command UUID,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX manager_invitations_pending_idx ON manager_invitations(employee_id)
    WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE TRIGGER manager_invitations_set_updated_at BEFORE UPDATE ON manager_invitations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TABLE manager_staff_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    command_id UUID NOT NULL,
    request_hash BYTEA NOT NULL CHECK (octet_length(request_hash) = 32),
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (actor_id, command_id)
);
CREATE TRIGGER manager_staff_receipts_set_updated_at BEFORE UPDATE ON manager_staff_receipts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX admin_audit_manager_scope_idx ON admin_audit_log(created_at DESC, id DESC)
    WHERE action LIKE 'manager.%';
