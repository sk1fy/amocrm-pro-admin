ALTER TABLE manager_grants DROP CONSTRAINT manager_grants_grant_code_check;
ALTER TABLE manager_grants ADD CONSTRAINT manager_grants_grant_code_check CHECK (
    grant_code IN (
        'catalog.manage', 'catalog.read', 'clients.read', 'clients.renew', 'clients.write',
        'configuration.manage', 'feed.read', 'identity.manage',
        'security.audit.read', 'staff.manage', 'stats.read'
    )
);

WITH assigned AS (
    INSERT INTO manager_grants (employee_id, grant_code)
    SELECT employee_id, 'catalog.read' FROM manager_grants WHERE grant_code = 'clients.read'
    ON CONFLICT (employee_id, grant_code) DO NOTHING
    RETURNING employee_id
)
UPDATE employees
SET manager_grants_version = manager_grants_version + 1,
    manager_suspended_grants = CASE WHEN 'clients.read' = ANY(manager_suspended_grants)
        THEN ARRAY(SELECT unnest(manager_suspended_grants || ARRAY['catalog.read']) ORDER BY 1)
        ELSE manager_suspended_grants END
WHERE id IN (SELECT employee_id FROM assigned) OR 'clients.read' = ANY(manager_suspended_grants);
