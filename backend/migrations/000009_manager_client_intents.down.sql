ALTER TABLE manager_command_intents
    DROP CONSTRAINT manager_command_intents_target_check,
    ALTER COLUMN target_id SET NOT NULL,
    ALTER COLUMN expected_version SET NOT NULL,
    ADD CONSTRAINT manager_command_intents_kind_check CHECK (kind IN ('installation.review', 'installation.crm_deal.retry')),
    DROP COLUMN related_id;
