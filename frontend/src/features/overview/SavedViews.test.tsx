import { describe, expect, it } from 'vitest'
import { viewMatchesCurrent } from './SavedViews'

describe('SavedViews', () => {
  it('matches legacy accounts views to explicit all, never to the real default', () => {
    expect(viewMatchesCurrent({ limit: 25 }, { limit: 25, origin: 'all' }, 'accounts')).toBe(true)
    expect(viewMatchesCurrent({ limit: 25 }, { limit: 25, origin: 'real' }, 'accounts')).toBe(false)
    expect(viewMatchesCurrent({}, { origin: 'all' }, 'operations')).toBe(false)
  })
  it('treats the current URL params as the active view and ignores cursor', () => {
    expect(
      viewMatchesCurrent(
        { status: 'failed', type: 'webhook.reconcile', cursor: 'old' },
        { status: 'failed', type: 'webhook.reconcile', cursor: 'new' },
      ),
    ).toBe(true)
    expect(viewMatchesCurrent({ status: 'failed' }, { status: 'completed' })).toBe(false)
  })
})
