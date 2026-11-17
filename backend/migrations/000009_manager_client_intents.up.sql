ALTER TABLE manager_command_intents
    DROP CONSTRAINT manager_command_intents_kind_check,
    ALTER COLUMN target_id DROP NOT NULL,
    ALTER COLUMN expected_version DROP NOT NULL,
    ADD COLUMN related_id UUID,
    ADD CONSTRAINT manager_command_intents_target_check CHECK (
        (kind IN ('installation.review', 'installation.crm_deal.retry',
                  'account.profile', 'account.portrait', 'account.portrait_audit_date',
                  'portrait.niche.update', 'portrait.niche.delete')
            AND target_id IS NOT NULL AND expected_version IS NOT NULL AND related_id IS NULL)
        OR (kind IN ('account.renewal', 'portrait.niche.merge')
            AND num_nonnulls(target_id, expected_version, related_id) = 3)
        OR (kind = 'account.refresh' AND target_id IS NOT NULL AND num_nonnulls(expected_version, related_id) = 0)
        OR (kind = 'portrait.template' AND expected_version IS NOT NULL AND num_nonnulls(target_id, related_id) = 0)
        OR (kind = 'portrait.niche.create' AND num_nonnulls(target_id, expected_version, related_id) = 0));
