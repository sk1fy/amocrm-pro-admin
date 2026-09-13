import { describe, expect, it } from 'vitest'
import { exploreURL, unixFromDateInput, unixFromRFC3339 } from './observability'
import { EMPTY, formatNull } from './format'

describe('exploreURL', () => {
  it('puts identifiers in the query string and not as invented labels', () => {
    const url = exploreURL(
      'https://grafana.example.invalid/explore',
      'now-24h',
      'now',
      'account_id=91000001 installation_id=f1a00000',
    )
    expect(url).toContain('query=account_id%3D91000001')
    expect(url).toContain('from=now-24h')
  })
  it('returns undefined when base is empty', () => {
    expect(exploreURL(undefined, 'now-24h', 'now', 'account_id=1')).toBeUndefined()
  })
})

describe('null versus zero', () => {
  it('keeps zero as zero', () => {
    expect(formatNull(0)).toBe('0')
    expect(formatNull(null)).toBe(EMPTY)
    expect(unixFromRFC3339(null)).toBe(0)
    expect(unixFromDateInput('2026-09-01', false)).toBe(Date.parse('2026-09-01T00:00:00Z') / 1000)
    expect(unixFromDateInput('2026-09-01', true)).toBe(Date.parse('2026-09-01T23:59:59Z') / 1000)
  })
})
