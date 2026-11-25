ALTER TABLE manager_command_intents
    DROP CONSTRAINT manager_command_intents_target_check,
    ADD CONSTRAINT manager_command_intents_target_check CHECK (
        (kind IN ('installation.review', 'installation.crm_deal.retry',
                  'account.subscription', 'account.profile', 'account.portrait', 'account.portrait_audit_date',
                  'portrait.niche.update', 'portrait.niche.delete', 'product.update', 'product.company_workflow.set')
            AND target_id IS NOT NULL AND expected_version IS NOT NULL AND related_id IS NULL)
        OR (kind IN ('account.renewal', 'portrait.niche.merge')
            AND num_nonnulls(target_id, expected_version, related_id) = 3)
        OR (kind = 'account.refresh' AND target_id IS NOT NULL AND num_nonnulls(expected_version, related_id) = 0)
        OR (kind IN ('portrait.template', 'installation.deal_settings.set') AND expected_version IS NOT NULL AND num_nonnulls(target_id, related_id) = 0)
        OR (kind IN ('portrait.niche.create', 'product.create') AND num_nonnulls(target_id, expected_version, related_id) = 0));
