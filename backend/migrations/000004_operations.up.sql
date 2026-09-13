CREATE TABLE operations (
 id UUID PRIMARY KEY,
 employee_id UUID NOT NULL REFERENCES employees(id),
 actor_email TEXT NOT NULL,
 request_id UUID NOT NULL,
 changed_fields JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(changed_fields)='array'),
 backend TEXT NOT NULL,
 target_type TEXT NOT NULL CHECK (target_type IN ('installation','integration','job','delivery')),
 target_id TEXT NOT NULL,
 command TEXT NOT NULL,
 idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
 request_hash BYTEA NOT NULL CHECK (octet_length(request_hash)=32),
 state TEXT NOT NULL CHECK (state IN ('accepted','pending','running','succeeded','failed','partial','unknown_outcome')),
 outcome TEXT NOT NULL DEFAULT '',
 result JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(result)='object'),
 error JSONB,
 lease_until TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 finished_at TIMESTAMPTZ,
 observed_at TIMESTAMPTZ,
 UNIQUE (backend,target_type,target_id,command,idempotency_key)
);
CREATE UNIQUE INDEX operations_active_target ON operations(backend,target_type,target_id)
 WHERE state IN ('accepted','running','pending');
CREATE INDEX operations_created_id ON operations(created_at DESC,id DESC);
CREATE INDEX operations_target_created ON operations(backend,target_type,target_id,created_at DESC,id DESC);
CREATE INDEX operations_state_created ON operations(state,created_at DESC,id DESC);
CREATE INDEX operations_request_key ON operations(idempotency_key,created_at DESC,id DESC);
CREATE TRIGGER operations_updated_at BEFORE UPDATE ON operations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
