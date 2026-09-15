import { describe, expect, it } from 'vitest'
import type { BackendRegistryEntry } from '../../api/types'
import { backendAbsenceReason, partitionAttention, problemSeverity } from './attention'

describe('partitionAttention', () => {
  it('puts non-zero and unavailable first and groups zeros as passed', () => {
    const { open, passed } = partitionAttention([
      { problem: 'disabled', count: 3, unavailable: false },
      { problem: 'reauth_required', count: 1, unavailable: false },
      { problem: 'webhook_error', count: 0, unavailable: false },
      { problem: 'job_failures', count: 2, unavailable: false },
      { problem: 'missing_credentials', count: 0, unavailable: true },
      { problem: 'source_unavailable', count: 0, unavailable: false },
    ])
    expect(open.map((item) => item.problem)).toEqual([
      'job_failures',
      'reauth_required',
      'missing_credentials',
      'disabled',
    ])
    expect(passed.map((item) => item.problem)).toEqual(['webhook_error', 'source_unavailable'])
  })

  it('ranks error and action before disabled', () => {
    expect(problemSeverity('webhook_error')).toBeLessThan(problemSeverity('reauth_required'))
    expect(problemSeverity('reauth_required')).toBeLessThan(problemSeverity('disabled'))
  })
})

describe('backendAbsenceReason', () => {
  const base: BackendRegistryEntry = {
    backend: 'core',
    kind: 'core-http',
    display_name: 'Core',
    products: [],
    status: 'available',
    contract_version: 'v1',
    revision: 'abc',
    adapter_capabilities: [],
    backend_capabilities: [],
    observed_at: '2026-09-14T10:00:00Z',
    checked_at: '2026-09-14T10:05:00Z',
  }

  it('explains unknown separately from unavailable', () => {
    expect(
      backendAbsenceReason({ ...base, status: 'unknown', revision: '', observed_at: null }),
    ).toBe('Данных нет: бекенд ещё не опрашивался.')
    expect(
      backendAbsenceReason({
        ...base,
        status: 'unavailable',
        error: { code: 'timeout', message: 'нет ответа' },
      }),
    ).toBe('Источник недоступен: нет ответа')
  })
})
