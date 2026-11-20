WITH removed AS (
    DELETE FROM manager_grants WHERE grant_code = 'catalog.read' RETURNING employee_id
)
UPDATE employees
SET manager_grants_version = manager_grants_version + 1,
    manager_suspended_grants = NULLIF(array_remove(manager_suspended_grants, 'catalog.read'), ARRAY[]::text[])
WHERE id IN (SELECT employee_id FROM removed) OR 'catalog.read' = ANY(manager_suspended_grants);

ALTER TABLE manager_grants DROP CONSTRAINT manager_grants_grant_code_check;
ALTER TABLE manager_grants ADD CONSTRAINT manager_grants_grant_code_check CHECK (
    grant_code IN (
        'catalog.manage', 'clients.read', 'clients.renew', 'clients.write',
        'configuration.manage', 'feed.read', 'identity.manage',
        'security.audit.read', 'staff.manage', 'stats.read'
    )
);
