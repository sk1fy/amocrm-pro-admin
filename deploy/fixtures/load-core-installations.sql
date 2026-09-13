-- Synthetic LOAD fixture for the Core admin read EXPLAIN check (stage 4.3).
--
-- Purpose: reproduce a realistic pilot-scale database so the heaviest
-- internal/adminread queries can be measured with EXPLAIN (ANALYZE, BUFFERS).
-- Target: ONLY the scratch database `admin_load_check` inside the disposable
-- pilot container (amocrm-activity-postgres-1). Never apply it to a live or
-- shared database. There is intentionally no make target for it.
--
-- Expected flow (all inside the scratch DB):
--   1. apply migrations/*.up.sql in order;
--   2. psql -f deploy/fixtures/load-core-installations.sql;
--   3. ANALYZE;
--   4. run EXPLAIN checks, then DROP DATABASE admin_load_check;
--   5. psql -l must show no admin_load_check.
--
-- Properties:
--   * insert-only and not idempotent: it fills an empty scratch database;
--   * ~20 000 accounts, ~100 000 installations, ~200 000 jobs,
--     ~300 000 audit_log rows, ~150 000 job_attempts, ~77 000
--     oauth_credentials, plus integrations/grants/pilots/destinations and
--     failed Activity outbox rows for the stats joins;
--   * every account domain is invented (`load-<n>.amocrm.test`);
--   * installations.settings and integrations.settings carry
--     "origin": "fixture", audit metadata too;
--   * token/ciphertext columns contain invented bytes ("load"), not secrets.
--
-- State distribution (deterministic, driven by generate_series):
--   installations: 70% active, 10% reauth_required, 8% disabled, 5% error,
--     4% pending, 3% uninstalled;
--   jobs: 15% queued, 5% processing, 5% retry, 45% completed, 12% failed,
--     8% dead, 10% cancelled; the last 30 days by created_at/updated_at.

DO $$
BEGIN
    IF current_database() <> 'admin_load_check' THEN
        RAISE EXCEPTION 'refusing to load: target database is %, expected admin_load_check',
            current_database();
    END IF;
END $$;

INSERT INTO integrations (id, code, client_id, client_secret_ciphertext,
                          redirect_uri, status, webhook_events, settings)
VALUES
    ('1a000000-0000-4000-8000-000000000001', 'load-widget-a', 'load-client-a',
     '\x6c6f6164', 'https://load.example.invalid/oauth/amocrm/callback',
     'active', '["add_lead","status_lead"]'::jsonb, '{"origin":"fixture"}'::jsonb),
    ('1a000000-0000-4000-8000-000000000002', 'load-widget-b', 'load-client-b',
     '\x6c6f6164', 'https://load.example.invalid/oauth/amocrm/callback',
     'active', '["add_lead","status_lead"]'::jsonb, '{"origin":"fixture"}'::jsonb),
    ('1a000000-0000-4000-8000-000000000003', 'load-widget-c', 'load-client-c',
     '\x6c6f6164', 'https://load.example.invalid/oauth/amocrm/callback',
     'active', '["add_lead"]'::jsonb, '{"origin":"fixture"}'::jsonb),
    ('1a000000-0000-4000-8000-000000000004', 'load-widget-d', 'load-client-d',
     '\x6c6f6164', 'https://load.example.invalid/oauth/amocrm/callback',
     'active', '["add_lead"]'::jsonb, '{"origin":"fixture"}'::jsonb),
    ('1a000000-0000-4000-8000-000000000005', 'load-widget-e', 'load-client-e',
     '\x6c6f6164', 'https://load.example.invalid/oauth/amocrm/callback',
     'active', '["add_lead"]'::jsonb, '{"origin":"fixture"}'::jsonb);

INSERT INTO integration_services (integration_id, service_code, enabled)
SELECT i.id, service.code, service.enabled
FROM integrations i
CROSS JOIN (VALUES ('lead-status', true), ('activity', true),
                   ('crm-events', true)) AS service(code, enabled)
WHERE i.code LIKE 'load-widget-%';

-- 20 000 accounts x 5 installations = 100 000 installations.
-- Installation sequence s: account = (s-1)/5 + 1, slot = (s-1)%5 + 1.
INSERT INTO installations (id, integration_id, account_id, account_domain,
                           status, installed_by, settings, webhook_status,
                           webhook_settings, webhook_checked_at,
                           created_at, updated_at)
SELECT
    ('2a000000-0000-4000-8000-' || lpad(to_hex(s), 12, '0'))::uuid,
    CASE (s - 1) % 5
        WHEN 0 THEN '1a000000-0000-4000-8000-000000000001'
        WHEN 1 THEN '1a000000-0000-4000-8000-000000000002'
        WHEN 2 THEN '1a000000-0000-4000-8000-000000000003'
        WHEN 3 THEN '1a000000-0000-4000-8000-000000000004'
        ELSE '1a000000-0000-4000-8000-000000000005'
    END::uuid,
    700000000 + ((s - 1) / 5) + 1,
    'load-' || ((s - 1) / 5 + 1)::text || '.amocrm.test',
    CASE
        WHEN s % 100 < 70 THEN 'active'
        WHEN s % 100 < 80 THEN 'reauth_required'
        WHEN s % 100 < 88 THEN 'disabled'
        WHEN s % 100 < 93 THEN 'error'
        WHEN s % 100 < 97 THEN 'pending'
        ELSE 'uninstalled'
    END,
    500 + (s % 40),
    '{"origin":"fixture","load":true}'::jsonb,
    CASE
        WHEN (s * 37) % 100 < 80 THEN 'active'
        WHEN (s * 37) % 100 < 88 THEN 'error'
        WHEN (s * 37) % 100 < 93 THEN 'disabled'
        WHEN (s * 37) % 100 < 97 THEN 'pending'
        ELSE 'unregistered'
    END,
    '["add_lead","status_lead"]'::jsonb,
    now() - make_interval(mins => s % 10080),
    now() - make_interval(mins => (s % 43200) + 60),
    now() - make_interval(mins => s % 43200)
FROM generate_series(1, 100000) AS s;

-- OAuth credentials for every connected-ish installation.
INSERT INTO oauth_credentials (installation_id, access_token_ciphertext,
                               refresh_token_ciphertext, expires_at,
                               token_version, key_version, refreshed_at,
                               created_at, updated_at)
SELECT i.id, '\x6c6f6164'::bytea, '\x6c6f6164'::bytea,
       CASE WHEN i.status = 'reauth_required'
            THEN now() - interval '2 hours'
            ELSE now() + interval '2 hours' END,
       1 + (i.account_id % 5), 1,
       greatest(i.created_at,
                now() - make_interval(mins => (i.account_id % 600)::int)),
       i.created_at, i.updated_at
FROM installations i
WHERE i.id::text LIKE '2a000000-%'
  AND i.status IN ('active', 'reauth_required', 'authorizing');

-- Activity pilot flags for the first 30 000 installations.
INSERT INTO activity_pilots (installation_id, enabled, updated_at)
SELECT ('2a000000-0000-4000-8000-' || lpad(to_hex(s), 12, '0'))::uuid,
       s % 2 = 0,
       now() - make_interval(mins => s)
FROM generate_series(1, 30000) AS s;

-- Owned webhook destinations (correlated count in the installation card).
INSERT INTO installation_webhook_destinations (installation_id,
                                               destination_hash,
                                               destination_ciphertext,
                                               key_version)
SELECT i.id, digest('load-destination-' || i.account_id::text, 'sha256'),
       '\x6c6f6164'::bytea, 1
FROM installations i
WHERE i.id::text LIKE '2a000000-%'
  AND i.account_id % 2 = 0;

-- 200 000 jobs (2 per installation), sequence s mapped to installation.
INSERT INTO jobs (id, installation_id, type, status, priority, payload,
                  attempts, max_attempts, run_after, last_error_code,
                  last_error_message, created_at, updated_at, finished_at)
SELECT
    ('3a000000-0000-4000-8000-' || lpad(to_hex(s), 12, '0'))::uuid,
    ('2a000000-0000-4000-8000-' || lpad(to_hex((s - 1) / 2 + 1), 12, '0'))::uuid,
    CASE s % 5
        WHEN 0 THEN 'webhook.reconcile'
        WHEN 1 THEN 'webhook.parse'
        WHEN 2 THEN 'workflow.lead.set_status'
        WHEN 3 THEN 'widget.ping'
        ELSE 'webhook.process_event'
    END,
    CASE
        WHEN s % 100 < 15 THEN 'queued'
        WHEN s % 100 < 20 THEN 'processing'
        WHEN s % 100 < 25 THEN 'retry'
        WHEN s % 100 < 70 THEN 'completed'
        WHEN s % 100 < 82 THEN 'failed'
        WHEN s % 100 < 90 THEN 'dead'
        ELSE 'cancelled'
    END,
    100,
    '{}'::jsonb,
    CASE
        WHEN s % 100 < 15 THEN 0
        WHEN s % 100 < 20 THEN 1
        WHEN s % 100 < 25 THEN 2
        WHEN s % 100 < 82 THEN 3
        WHEN s % 100 < 90 THEN 5
        ELSE 1
    END,
    5,
    now() - make_interval(mins => s % 43200),
    CASE WHEN s % 100 >= 70 AND s % 100 < 90
         THEN 'load_failure' END,
    CASE WHEN s % 100 >= 70 AND s % 100 < 90
         THEN 'fixture: synthetic load failure' END,
    now() - make_interval(mins => s % 43200),
    now() - make_interval(mins => greatest((s % 43200) - 5, 0)),
    CASE WHEN s % 100 >= 25
         THEN now() - make_interval(mins => greatest((s % 43200) - 5, 0)) END
FROM generate_series(1, 200000) AS s;

-- One attempt per terminal job: feeds the latency percentile query.
INSERT INTO job_attempts (job_id, attempt, worker_id, started_at,
                          finished_at, outcome, duration_ms)
SELECT j.id, j.attempts, 'load-worker',
       j.finished_at - make_interval(secs => 50 + j.attempts),
       j.finished_at,
       'completed',
       50 + (abs(hashtext(j.id::text)) % 2950)
FROM jobs j
WHERE j.id::text LIKE '3a000000-%'
  AND j.finished_at IS NOT NULL;

-- 300 000 audit rows spread over 40 days.
INSERT INTO audit_log (installation_id, actor_type, actor_id, action,
                       object_type, object_id, metadata, created_at)
SELECT
    ('2a000000-0000-4000-8000-' || lpad(to_hex(1 + (s % 100000)), 12, '0'))::uuid,
    CASE
        WHEN s % 100 < 60 THEN 'system'
        WHEN s % 100 < 85 THEN 'admin'
        ELSE 'operator'
    END,
    'load-actor-' || (s % 500)::text,
    CASE
        WHEN s % 100 < 25 THEN 'installation.authorized'
        WHEN s % 100 < 30 THEN 'installation.disable'
        WHEN s % 100 < 33 THEN 'installation.uninstall'
        WHEN s % 100 < 35 THEN 'installation.revoke'
        WHEN s % 100 < 55 THEN 'lead.set_status'
        WHEN s % 100 < 70 THEN 'webhook.reconcile.requested'
        WHEN s % 100 < 80 THEN 'activity.pilot'
        WHEN s % 100 < 85 THEN 'integration.created'
        WHEN s % 100 < 95 THEN 'settings.changed'
        ELSE 'job.retry'
    END,
    'installation',
    ('2a000000-0000-4000-8000-'
        || lpad(to_hex(1 + (s % 100000)), 12, '0')),
    '{"origin":"fixture"}'::jsonb,
    now() - make_interval(mins => s % 57600)
FROM generate_series(1, 300000) AS s;

-- Failed Activity sync commands for the stats sync_problems query.
INSERT INTO activity_command_receipts (command_id, installation_id,
                                       integration_id, actor_id, target,
                                       action, version, key_hash,
                                       request_hash, created_at)
SELECT
    ('4a000000-0000-4000-8000-' || lpad(to_hex(s), 12, '0'))::uuid,
    i.id, i.integration_id, 0, 'activity', 'settings', 1,
    digest('load-key-' || s::text, 'sha256'),
    digest('load-request-' || s::text, 'sha256'),
    now() - make_interval(mins => s % 10080)
FROM generate_series(1, 4000) AS s
JOIN installations i
  ON i.id = ('2a000000-0000-4000-8000-' || lpad(to_hex(s), 12, '0'))::uuid;

INSERT INTO activity_command_outbox (command_id, payload, status, attempts,
                                     max_attempts, run_after, error_code,
                                     updated_at)
SELECT r.command_id, '{}'::jsonb,
       CASE WHEN s % 5 < 3 THEN 'failed' ELSE 'accepted' END,
       CASE WHEN s % 5 < 3 THEN 20 ELSE 1 END,
       20,
       r.created_at,
       CASE WHEN s % 5 < 3 THEN 'activity_unavailable' END,
       r.created_at + interval '1 minute'
FROM generate_series(1, 4000) AS s
JOIN activity_command_receipts r
  ON r.command_id = ('4a000000-0000-4000-8000-'
        || lpad(to_hex(s), 12, '0'))::uuid;

ANALYZE;
