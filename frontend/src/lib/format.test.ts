import { describe, expect, it } from 'vitest'
import { EMPTY, formatNull, safeNextPath } from './format'

describe('formatNull', () => {
  it('renders null as em dash and zero as zero', () => {
    expect(formatNull(null)).toBe(EMPTY)
    expect(formatNull(undefined)).toBe(EMPTY)
    expect(formatNull('')).toBe(EMPTY)
    expect(formatNull(0)).toBe('0')
    expect(formatNull('0')).toBe('0')
  })
})

describe('safeNextPath', () => {
  it('rejects open redirects', () => {
    expect(safeNextPath('/accounts/1')).toBe('/accounts/1')
    expect(safeNextPath('https://evil.example')).toBe('/')
    expect(safeNextPath('//evil.example')).toBe('/')
  })
})
