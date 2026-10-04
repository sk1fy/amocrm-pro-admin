import { describe, expect, it } from 'vitest'
import { connectionSearch } from '../../app/search'
import { canReconcileDistribution, distributionCommand } from './DistributionSection'
import type { DistributionTraceItem } from '../../api/types'
import { lookupState } from '../../states'

describe('distribution diagnostics contract', () => {
  it.each<[string, string | null, boolean]>([
    ['applying', 'in_flight', true],
    ['confirming', 'settled', true],
    ['outcome_unknown', 'unknown', true],
    ['succeeded', 'settled', false],
    ['conflict', 'settled', false],
    ['rejected', 'no_attempt', false],
    ['cancelled', 'no_attempt', false],
    ['queued', 'no_attempt', false],
    ['prechecking', 'no_attempt', false],
    ['applying', 'no_attempt', false],
    ['outcome_unknown', null, false],
    ['future_state', 'unknown', false],
  ])('offers only a read-only recovery for %s/%s', (state, effect, expected) => {
    const row: DistributionTraceItem = {
      kind: 'operation',
      id: 'd1500000-0000-4000-8000-000000000002',
      state,
      created_at: '2026-10-04T00:00:00Z',
      message_id: null,
      error_code: null,
      event_id: null,
      operation_id: null,
      correlation_id: null,
      causation_id: null,
      lead_id: null,
      result_version: 1,
      external_effect_state: effect,
      evidence: null,
      attempts: null,
    }
    expect(canReconcileDistribution(row)).toBe(expected)
    expect(canReconcileDistribution({ ...row, kind: 'result' })).toBe(false)
    expect(canReconcileDistribution({ ...row, result_version: null })).toBe(false)
    expect(canReconcileDistribution({ ...row, result_version: 0 })).toBe(false)
  })
  it('keeps exact installation scope, privileges and honest command semantics', () => {
    for (const command of [
      'distribution-pause',
      'distribution-resume',
      'distribution-delivery-retry',
      'distribution-reconcile',
    ]) {
      const spec = distributionCommand('core', 'installation-id', command)
      expect(spec.targetType).toBe('installation')
      expect(spec.targetId).toBe('installation-id')
      expect(spec.path).toBe(`/api/v1/connections/core/installation-id/commands/${command}`)
      expect(spec.permission).toBe(
        command.includes('pause') || command.includes('resume')
          ? 'connections:disable'
          : 'operations:retry',
      )
    }
    expect(distributionCommand('core', 'id', 'distribution-reconcile').consequence).toContain(
      'Новое назначение не отправляется',
    )
  })
  it('preserves all URL filters and honest unknown states', () => {
    expect(
      connectionSearch({
        section: 'distribution',
        reference: 'id',
        distribution_cursor: 'cursor',
        distribution_limit: '1',
      }),
    ).toEqual({
      section: 'distribution',
      reference: 'id',
      distribution_cursor: 'cursor',
      distribution_limit: 1,
    })
    expect(
      connectionSearch({ section: 'distribution', distribution_cursor: 1 }).distribution_cursor,
    ).toBe('1')
    expect(lookupState('distribution', 'outcome_unknown').tone).toBe('unknown')
    expect(lookupState('distribution', 'future_state').tone).toBe('unknown')
    expect(lookupState('distribution_effect', 'unknown').tone).toBe('unknown')
  })
})
