ALTER TABLE employees ADD COLUMN manager_suspended_grants text[]
    CHECK (cardinality(manager_suspended_grants) > 0);
