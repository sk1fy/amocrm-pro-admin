import { describe, expect, it } from 'vitest'
import { accountsSearch } from './search'

describe('account origin filter', () => {
  it('defaults to real accounts and preserves explicit fixture/all URLs', () => {
    expect(accountsSearch({}).origin).toBe('real')
    expect(accountsSearch({ origin: 'unexpected' }).origin).toBe('real')
    expect(accountsSearch({ origin: 'fixture' }).origin).toBe('fixture')
    expect(accountsSearch({ origin: 'all', q: '91000002', cursor: 'next' })).toMatchObject({
      origin: 'all',
      q: '91000002',
      cursor: 'next',
    })
  })
})
