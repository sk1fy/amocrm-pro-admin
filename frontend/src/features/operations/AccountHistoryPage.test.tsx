import { describe, expect, it } from 'vitest'
import { historyObjectHref } from './AccountHistoryPage'

describe('historyObjectHref', () => {
  it('builds account and connection routes from typed fields', () => {
    expect(
      historyObjectHref(
        {
          source: 'core',
          backend: 'core',
          occurred_at: '2026-09-14T10:00:00Z',
          action: 'installation.enabled',
          object_type: 'installation',
          connection_id: 'conn-1',
          metadata: {},
        },
        '91000002',
      ),
    ).toBe('/accounts/91000002/widgets/core/conn-1')
    expect(
      historyObjectHref(
        {
          source: 'admin',
          occurred_at: '2026-09-14T10:00:00Z',
          action: 'auth.login_failed',
          object_ref: 'account:91000002',
          metadata: {},
        },
        '91000002',
      ),
    ).toBe('/accounts/91000002')
  })
})
