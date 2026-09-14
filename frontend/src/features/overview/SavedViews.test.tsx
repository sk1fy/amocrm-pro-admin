import { describe, expect, it } from 'vitest'
import { viewMatchesCurrent } from './SavedViews'

describe('SavedViews', () => {
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
