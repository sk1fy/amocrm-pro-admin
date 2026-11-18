DELETE FROM sessions WHERE audience = 'managers';
DROP TABLE manager_grants;
DROP INDEX sessions_employee_audience_created_idx;
ALTER TABLE sessions DROP COLUMN audience;
