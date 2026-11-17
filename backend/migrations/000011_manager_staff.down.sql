DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM employees WHERE NOT technical_access)
       OR EXISTS (SELECT 1 FROM manager_invitations)
       OR EXISTS (SELECT 1 FROM manager_staff_receipts) THEN
        RAISE EXCEPTION 'manager-only identities or retained invitation history prevent downgrade';
    END IF;
END $$;
DROP INDEX admin_audit_manager_scope_idx;
DROP TABLE manager_staff_receipts;
DROP TABLE manager_invitations;
DROP INDEX employees_staff_email_id_idx;
ALTER TABLE employees DROP COLUMN manager_changed_by;
ALTER TABLE employees DROP COLUMN manager_changed_at;
ALTER TABLE employees DROP COLUMN technical_access;
