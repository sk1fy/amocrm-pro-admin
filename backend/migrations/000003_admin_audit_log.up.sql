CREATE TABLE admin_audit_log (
    id            BIGSERIAL PRIMARY KEY,
    employee_id   UUID REFERENCES employees(id),
    actor_email   TEXT,
    action        TEXT NOT NULL,
    object_type   TEXT,
    object_ref    TEXT,
    outcome       TEXT NOT NULL DEFAULT 'ok',
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
CREATE INDEX admin_audit_created_id_idx ON admin_audit_log (created_at DESC, id DESC);
