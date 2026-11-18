ALTER TABLE sessions ADD COLUMN audience TEXT NOT NULL DEFAULT 'core-admin'
    CHECK (audience IN ('core-admin', 'managers'));
CREATE INDEX sessions_employee_audience_created_idx
    ON sessions (employee_id, audience, created_at DESC, id DESC);

CREATE TABLE manager_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    grant_code TEXT NOT NULL CHECK (grant_code IN (
        'catalog.manage', 'clients.read', 'clients.renew', 'clients.write',
        'configuration.manage', 'feed.read', 'identity.manage',
        'security.audit.read', 'staff.manage', 'stats.read'
    )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (employee_id, grant_code)
);
CREATE TRIGGER manager_grants_set_updated_at BEFORE UPDATE ON manager_grants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
