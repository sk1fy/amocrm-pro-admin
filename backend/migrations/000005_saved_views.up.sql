CREATE TABLE saved_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_employee_id UUID REFERENCES employees(id),
    section TEXT NOT NULL,
    name TEXT NOT NULL,
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    columns JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    CONSTRAINT saved_views_section_check CHECK (section IN ('accounts', 'operations', 'stats')),
    CONSTRAINT saved_views_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT saved_views_params_object CHECK (jsonb_typeof(params) = 'object'),
    CONSTRAINT saved_views_columns_array CHECK (jsonb_typeof(columns) = 'array')
);
CREATE INDEX saved_views_owner_section_idx ON saved_views (owner_employee_id, section);
CREATE INDEX saved_views_shared_section_idx ON saved_views (section) WHERE owner_employee_id IS NULL;
CREATE UNIQUE INDEX saved_views_owner_section_name_key
    ON saved_views (owner_employee_id, section, name)
    WHERE owner_employee_id IS NOT NULL;
CREATE UNIQUE INDEX saved_views_shared_section_name_key
    ON saved_views (section, name)
    WHERE owner_employee_id IS NULL;
CREATE TRIGGER saved_views_updated_at
    BEFORE UPDATE ON saved_views
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
