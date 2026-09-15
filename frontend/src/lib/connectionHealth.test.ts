import { describe, expect, it } from 'vitest'
import type { ActivitySync, ConnectionCard, ConnectionIdentity, Observation } from '../api/types'
import {
  computeConnectionHealth,
  lastSyncDurationSeconds,
  sectionDefaultOpen,
  syncIdleReason,
  webhookSuccessfulCheckAt,
} from './connectionHealth'

function obs<T>(
  data: T | null,
  freshness = 'fresh',
  error?: { code: string; message: string },
): Observation<T> {
  return {
    source: 'core',
    observed_at: '2026-09-14T20:00:00Z',
    freshness,
    data,
    error,
  }
}

function card(overrides: Partial<ConnectionCard> = {}): ConnectionCard {
  return {
    backend: 'core',
    connection: obs({
      id: 'inst-1',
      integration_id: 'int-1',
      integration_code: 'widget',
      account_id: '30402778',
      account_domain: 'fixture.amocrm.test',
      state: 'active',
      origin: 'real',
      created_at: '2026-09-04T10:00:00Z',
      updated_at: '2026-09-04T10:00:00Z',
    }),
    authorization: obs({
      state: 'valid',
      credentials_present: true,
      lease_active: false,
      unverified: false,
      expires_at: '2026-09-15T16:00:00Z',
    }),
    webhook: obs({
      status: 'active',
      events: ['add_lead'],
      confirmed_destinations: 1,
    }),
    grants: obs([]),
    activity: obs({ pilot: 'enabled', deliveries: [] }),
    activity_sync: obs({
      state: 'idle',
      reauth_required: false,
      lag_seconds: 0,
      last_event_at: '2026-09-14T19:50:00Z',
    }),
    recent_jobs: obs([]),
    recent_audit: obs([]),
    authorization_check: obs({
      classification: 'verified_ok',
      observed_at: '2026-09-14T19:55:00Z',
    }),
    ...overrides,
  }
}

describe('computeConnectionHealth', () => {
  it('marks a verified active connection as working', () => {
    const health = computeConnectionHealth(card())
    expect(health.state).toBe('working')
    expect(health.reasons).toEqual([])
  })

  it('treats a stale amoCRM check as a warning', () => {
    const health = computeConnectionHealth(
      card({
        authorization_check: obs({ classification: 'verified_ok' }, 'stale'),
      }),
    )
    expect(health.state).toBe('working_with_warnings')
    expect(health.reasons[0]).toMatch(/устарела/)
    expect(health.defaultSection).toBe('auth')
  })

  it('groups core admin authentication as one incident', () => {
    const error = { code: 'backend_unavailable', message: 'core admin authentication failed' }
    const health = computeConnectionHealth(
      card({
        activity: obs(null, 'unavailable', error),
        activity_sync: obs<ActivitySync>(null, 'unavailable', error),
      }),
    )
    expect(health.state).toBe('needs_action')
    expect(health.coreAuthIncident?.scopes).toEqual(['activity', 'sync'])
    expect(health.problems.filter((item) => item.title.includes('Activity')).length).toBe(1)
  })

  it('marks identity unavailable as unavailable', () => {
    const health = computeConnectionHealth(
      card({
        connection: obs<ConnectionIdentity>(null, 'unavailable', {
          code: 'timeout',
          message: 'timeout',
        }),
      }),
    )
    expect(health.state).toBe('unavailable')
  })
})

describe('syncIdleReason', () => {
  it('explains idle with recent events as no new events', () => {
    expect(
      syncIdleReason({
        state: 'idle',
        reauth_required: false,
        lag_seconds: 12,
        last_event_at: '2026-09-14T19:50:00Z',
      }),
    ).toMatch(/Нет новых событий/)
  })

  it('explains disabled sync', () => {
    expect(syncIdleReason({ state: 'disabled', reauth_required: false })).toMatch(/выключена/)
  })
})

describe('lastSyncDurationSeconds', () => {
  it('derives duration only when success follows the last event within a day', () => {
    expect(
      lastSyncDurationSeconds({
        state: 'idle',
        reauth_required: false,
        last_event_at: '2026-09-14T19:50:00Z',
        last_success_at: '2026-09-14T19:51:30Z',
      }),
    ).toBe(90)
  })

  it('skips when timestamps cannot form a run duration', () => {
    expect(
      lastSyncDurationSeconds({
        state: 'idle',
        reauth_required: false,
        last_event_at: '2026-09-14T19:51:30Z',
        last_success_at: '2026-09-14T19:50:00Z',
      }),
    ).toBeNull()
    expect(lastSyncDurationSeconds({ state: 'idle', reauth_required: false })).toBeNull()
  })
})

describe('webhookSuccessfulCheckAt', () => {
  it('returns checked_at only when there is no last error', () => {
    expect(webhookSuccessfulCheckAt('2026-09-14T19:00:00Z', null)).toBe('2026-09-14T19:00:00Z')
    expect(webhookSuccessfulCheckAt('2026-09-14T19:00:00Z', 'timeout')).toBeNull()
    expect(webhookSuccessfulCheckAt(null, null)).toBeNull()
  })
})

describe('sectionDefaultOpen', () => {
  it('opens problem and stale sections and collapses healthy ones', () => {
    expect(sectionDefaultOpen([{ id: 'disabled', title: 'x', section: 'status' }], 'status')).toBe(
      true,
    )
    expect(sectionDefaultOpen([], 'status', obs({ id: '1' }, 'stale'))).toBe(true)
    expect(sectionDefaultOpen([], 'status', obs({ id: '1' }))).toBe(false)
  })
})
