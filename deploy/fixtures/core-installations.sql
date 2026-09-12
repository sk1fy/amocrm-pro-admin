-- Labelled fixture installations for the amocrm-pro DEVELOPMENT pilot stack.
--
-- Purpose: give the admin panel several accounts, multiple widgets per account
-- and every connection/webhook/job state while no real amoCRM OAuth exists.
-- Every row is marked as fixture: installations.settings.origin = 'fixture',
-- audit_log.actor_type = 'fixture', domains end with .amocrm.test.
--
-- Preconditions: integrations `fixture-widget-a` and `fixture-widget-b` are
-- provisioned through the audited CLI (real code path, real secret handling):
--
--   docker compose -f docker-compose.activity.yml run --rm -T integrations create \
--     --actor fixture@example.invalid --code fixture-widget-a \
--     --client-id 0f1a0001-0000-4000-8000-000000000001 \
--     --redirect-uri https://backend.example.invalid/oauth/amocrm/callback \
--     --webhook-events add_lead,status_lead --services lead-status,activity \
--     --secret-stdin < /dev/fd/3 3<<<'fixture-secret-a'
--   (same for fixture-widget-b with client id ...0002 and --services lead-status)
--
-- Apply only via `make fixtures-core FIXTURES_CONFIRM=core-pilot`. Idempotent:
-- fixed UUIDs, ON CONFLICT DO NOTHING. Never run against production.
-- No oauth_credentials rows are inserted: authorization state is `missing`
-- (ciphertext cannot and must not be fabricated).

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM integrations WHERE code = 'fixture-widget-a')
       OR NOT EXISTS (SELECT 1 FROM integrations WHERE code = 'fixture-widget-b') THEN
        RAISE EXCEPTION 'fixture integrations are missing: provision fixture-widget-a and fixture-widget-b through the integrations CLI first';
    END IF;
END $$;

-- Account 91000001: two widgets, both active, webhook active. The "healthy" case.
INSERT INTO installations (id, integration_id, account_id, account_domain, status, installed_by,
                           settings, webhook_status, webhook_settings, webhook_checked_at)
SELECT 'f1a00000-0000-4000-8000-000000000001', i.id, 91000001, 'fixture-one.amocrm.test', 'active', 501,
       '{"origin":"fixture"}', 'active', '["add_lead","status_lead"]', now() - interval '10 minutes'
FROM integrations i WHERE i.code = 'fixture-widget-a'
ON CONFLICT (integration_id, account_id) DO NOTHING;

INSERT INTO installations (id, integration_id, account_id, account_domain, status, installed_by,
                           settings, webhook_status, webhook_settings, webhook_checked_at)
SELECT 'f1a00000-0000-4000-8000-000000000002', i.id, 91000001, 'fixture-one.amocrm.test', 'active', 501,
       '{"origin":"fixture"}', 'active', '["add_lead"]', now() - interval '12 minutes'
FROM integrations i WHERE i.code = 'fixture-widget-b'
ON CONFLICT (integration_id, account_id) DO NOTHING;

-- Account 91000002: widget A needs reauthorization while widget B is fine.
-- Proves that one connection's state must not override another's.
INSERT INTO installations (id, integration_id, account_id, account_domain, status, installed_by,
                           settings, webhook_status, webhook_settings, webhook_checked_at, webhook_last_error)
SELECT 'f1a00000-0000-4000-8000-000000000003', i.id, 91000002, 'fixture-two.amocrm.test', 'reauth_required', 502,
       '{"origin":"fixture"}', 'error', '["add_lead","status_lead"]', now() - interval '3 hours',
       'fixture: amoCRM responded 401 during subscription refresh'
FROM integrations i WHERE i.code = 'fixture-widget-a'
ON CONFLICT (integration_id, account_id) DO NOTHING;

INSERT INTO installations (id, integration_id, account_id, account_domain, status, installed_by,
                           settings, webhook_status, webhook_settings, webhook_checked_at)
SELECT 'f1a00000-0000-4000-8000-000000000004', i.id, 91000002, 'fixture-two.amocrm.test', 'active', 502,
       '{"origin":"fixture"}', 'active', '["add_lead"]', now() - interval '5 minutes'
FROM integrations i WHERE i.code = 'fixture-widget-b'
ON CONFLICT (integration_id, account_id) DO NOTHING;

-- Account 91000003: disabled by operator (reversible).
INSERT INTO installations (id, integration_id, account_id, account_domain, status, installed_by,
                           settings, webhook_status, webhook_settings, webhook_checked_at)
SELECT 'f1a00000-0000-4000-8000-000000000005', i.id, 91000003, 'fixture-three.amocrm.test', 'disabled', 503,
       '{"origin":"fixture"}', 'active', '["status_lead"]', now() - interval '2 days'
FROM integrations i WHERE i.code = 'fixture-widget-a'
ON CONFLICT (integration_id, account_id) DO NOTHING;

-- Account 91000004: uninstalled, webhooks unregistered (Kommo domain variant).
INSERT INTO installations (id, integration_id, account_id, account_domain, status, installed_by,
                           settings, webhook_status, webhook_settings, webhook_checked_at)
SELECT 'f1a00000-0000-4000-8000-000000000006', i.id, 91000004, 'fixture-four.kommo.test', 'uninstalled', 504,
       '{"origin":"fixture"}', 'unregistered', '[]', now() - interval '7 days'
FROM integrations i WHERE i.code = 'fixture-widget-b'
ON CONFLICT (integration_id, account_id) DO NOTHING;

-- Account 91000005: OAuth never completed.
INSERT INTO installations (id, integration_id, account_id, account_domain, status,
                           settings, webhook_status, webhook_settings)
SELECT 'f1a00000-0000-4000-8000-000000000007', i.id, 91000005, 'fixture-five.amocrm.test', 'pending',
       '{"origin":"fixture"}', 'pending', '[]'
FROM integrations i WHERE i.code = 'fixture-widget-a'
ON CONFLICT (integration_id, account_id) DO NOTHING;

-- Account 91000006: installation in error state with a dead job.
INSERT INTO installations (id, integration_id, account_id, account_domain, status, installed_by,
                           settings, webhook_status, webhook_settings, webhook_checked_at, webhook_last_error)
SELECT 'f1a00000-0000-4000-8000-000000000008', i.id, 91000006, 'fixture-six.amocrm.test', 'error', 506,
       '{"origin":"fixture"}', 'error', '["add_lead"]', now() - interval '1 hour',
       'fixture: webhook registration rejected by amoCRM (400)'
FROM integrations i WHERE i.code = 'fixture-widget-a'
ON CONFLICT (integration_id, account_id) DO NOTHING;

-- Activity pilot flags: enabled for the healthy account, disabled for the reauth one.
INSERT INTO activity_pilots (installation_id, enabled)
VALUES ('f1a00000-0000-4000-8000-000000000001', true),
       ('f1a00000-0000-4000-8000-000000000003', false)
ON CONFLICT (installation_id) DO NOTHING;

-- Jobs covering every queue state (payload/result stay empty objects: the
-- admin panel must not depend on them).
INSERT INTO jobs (id, installation_id, type, status, attempts, max_attempts, run_after, created_at, updated_at, finished_at,
                  last_error_code, last_error_message)
VALUES
  ('f1b00000-0000-4000-8000-000000000001', 'f1a00000-0000-4000-8000-000000000001', 'webhook.reconcile', 'completed', 1, 5,
   now() - interval '10 minutes', now() - interval '10 minutes', now() - interval '9 minutes', now() - interval '9 minutes', NULL, NULL),
  ('f1b00000-0000-4000-8000-000000000002', 'f1a00000-0000-4000-8000-000000000003', 'webhook.reconcile', 'failed', 5, 5,
   now() - interval '3 hours', now() - interval '3 hours', now() - interval '2 hours', now() - interval '2 hours',
   'installation_not_active', 'fixture: installation requires reauthorization'),
  ('f1b00000-0000-4000-8000-000000000003', 'f1a00000-0000-4000-8000-000000000008', 'webhook.reconcile', 'dead', 5, 5,
   now() - interval '1 hour', now() - interval '1 hour', now() - interval '30 minutes', now() - interval '30 minutes',
   'amocrm_bad_request', 'fixture: amoCRM rejected webhook destination'),
  ('f1b00000-0000-4000-8000-000000000004', 'f1a00000-0000-4000-8000-000000000004', 'webhook.parse', 'retry', 2, 5,
   now() + interval '2 minutes', now() - interval '6 minutes', now() - interval '1 minute', NULL,
   'temporary_failure', 'fixture: transient parse dependency failure'),
  ('f1b00000-0000-4000-8000-000000000005', 'f1a00000-0000-4000-8000-000000000002', 'webhook.parse', 'queued', 0, 5,
   now(), now() - interval '30 seconds', now() - interval '30 seconds', NULL, NULL, NULL),
  ('f1b00000-0000-4000-8000-000000000006', 'f1a00000-0000-4000-8000-000000000005', 'webhook.reconcile', 'cancelled', 0, 5,
   now() - interval '2 days', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO job_attempts (job_id, attempt, worker_id, started_at, finished_at, outcome, error_code, error_message, duration_ms)
VALUES
  ('f1b00000-0000-4000-8000-000000000001', 1, 'fixture-worker', now() - interval '10 minutes', now() - interval '9 minutes', 'completed', NULL, NULL, 850),
  ('f1b00000-0000-4000-8000-000000000002', 1, 'fixture-worker', now() - interval '3 hours', now() - interval '3 hours' + interval '2 seconds', 'retry', 'installation_not_active', 'fixture: retry 1', 1900),
  ('f1b00000-0000-4000-8000-000000000002', 2, 'fixture-worker', now() - interval '170 minutes', now() - interval '170 minutes' + interval '2 seconds', 'retry', 'installation_not_active', 'fixture: retry 2', 2100),
  ('f1b00000-0000-4000-8000-000000000002', 3, 'fixture-worker', now() - interval '160 minutes', now() - interval '160 minutes' + interval '2 seconds', 'retry', 'installation_not_active', 'fixture: retry 3', 2050),
  ('f1b00000-0000-4000-8000-000000000002', 4, 'fixture-worker', now() - interval '140 minutes', now() - interval '140 minutes' + interval '2 seconds', 'retry', 'installation_not_active', 'fixture: retry 4', 2000),
  ('f1b00000-0000-4000-8000-000000000002', 5, 'fixture-worker', now() - interval '120 minutes', now() - interval '120 minutes' + interval '2 seconds', 'failed', 'installation_not_active', 'fixture: attempts exhausted', 1980),
  ('f1b00000-0000-4000-8000-000000000003', 5, 'fixture-worker', now() - interval '31 minutes', now() - interval '30 minutes', 'dead', 'amocrm_bad_request', 'fixture: permanent failure', 400),
  ('f1b00000-0000-4000-8000-000000000004', 1, 'fixture-worker', now() - interval '6 minutes', now() - interval '6 minutes' + interval '1 second', 'retry', 'temporary_failure', 'fixture: retry 1', 1000),
  ('f1b00000-0000-4000-8000-000000000004', 2, 'fixture-worker', now() - interval '1 minute', now() - interval '1 minute' + interval '1 second', 'lease_expired', NULL, NULL, NULL)
ON CONFLICT (job_id, attempt) DO NOTHING;

-- Audit trail visible in the account "History" tab. actor_type marks fixtures.
INSERT INTO audit_log (installation_id, actor_type, actor_id, action, object_type, object_id, metadata, created_at)
SELECT n.id, 'fixture', 'fixture@example.invalid', 'installation.fixture_seeded', 'installation', n.id::text,
       jsonb_build_object('origin', 'fixture', 'status', n.status, 'webhook_status', n.webhook_status),
       now() - interval '1 minute'
FROM installations n
WHERE n.settings->>'origin' = 'fixture'
  AND NOT EXISTS (
      SELECT 1 FROM audit_log a
      WHERE a.installation_id = n.id AND a.action = 'installation.fixture_seeded');

INSERT INTO audit_log (installation_id, actor_type, actor_id, action, object_type, object_id, metadata, created_at)
SELECT 'f1a00000-0000-4000-8000-000000000003', 'fixture', 'fixture@example.invalid', 'installation.reauth_required',
       'installation', 'f1a00000-0000-4000-8000-000000000003',
       '{"origin":"fixture","reason":"amoCRM returned 401 twice during token refresh"}', now() - interval '3 hours'
WHERE NOT EXISTS (
    SELECT 1 FROM audit_log
    WHERE installation_id = 'f1a00000-0000-4000-8000-000000000003' AND action = 'installation.reauth_required');
