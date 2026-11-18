LOCK TABLE manager_command_intents IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (
        SELECT FROM manager_command_intents
        WHERE kind NOT IN ('installation.review', 'installation.crm_deal.retry')
    ) THEN
        RAISE EXCEPTION 'cannot revert migration 000009 while manager client intents exist'
            USING ERRCODE = '55000',
                HINT = 'Keep migration 000009 applied and follow the manager clients rollback procedure.';
    END IF;
END
$$;

ALTER TABLE manager_command_intents
    DROP CONSTRAINT manager_command_intents_target_check,
    ALTER COLUMN target_id SET NOT NULL,
    ALTER COLUMN expected_version SET NOT NULL,
    ADD CONSTRAINT manager_command_intents_kind_check CHECK (kind IN ('installation.review', 'installation.crm_deal.retry')),
    DROP COLUMN related_id;
