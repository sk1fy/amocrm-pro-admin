import { describe, expect, it } from 'vitest'
import { connectionSearch } from '../../app/search'
import { distributionCommand } from './DistributionSection'
import { lookupState } from '../../states'

describe('distribution diagnostics contract', () => {
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
