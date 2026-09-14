import { describe, expect, it } from 'vitest'
import type { Job } from '../../api/types'
import { jobDurationLabel, jobShowsAttempts, jobShowsError } from './JobsTable'

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    type: 'webhook.reconcile',
    status: 'completed',
    priority: 1,
    attempts: 1,
    max_attempts: 3,
    run_after: '2026-09-14T10:00:00Z',
    created_at: '2026-09-14T10:00:00Z',
    updated_at: '2026-09-14T10:00:02Z',
    ...overrides,
  }
}

describe('JobsTable helpers', () => {
  it('hides attempts and errors for successful jobs', () => {
    expect(jobShowsAttempts('completed')).toBe(false)
    expect(jobShowsError('completed')).toBe(false)
    expect(jobShowsAttempts('failed')).toBe(true)
    expect(jobShowsError('dead')).toBe(true)
    expect(jobShowsAttempts('processing')).toBe(true)
  })

  it('computes duration from created_at and finished_at', () => {
    expect(
      jobDurationLabel(
        job({ created_at: '2026-09-14T10:00:00Z', finished_at: '2026-09-14T10:02:00Z' }),
      ),
    ).toBe('2 мин')
    expect(jobDurationLabel(job({ finished_at: null }))).toBe('—')
  })
})
