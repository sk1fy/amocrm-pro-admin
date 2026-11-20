DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM employees WHERE manager_suspended_grants IS NOT NULL) THEN
        RAISE EXCEPTION 'manager access is suspended; restore or clear saved grants before rollback';
    END IF;
END;
$$;
ALTER TABLE employees DROP COLUMN manager_suspended_grants;
