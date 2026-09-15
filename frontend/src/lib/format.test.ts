import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  formatAttempts,
  formatDurationSeconds,
  formatExpiry,
  formatNull,
  formatRelativeTime,
  safeNextPath,
  shortenId,
} from './format'

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

describe('relative and duration formatters', () => {
  const now = new Date('2026-09-14T21:00:00Z')

  it('formats lag as minutes and seconds', () => {
    expect(formatDurationSeconds(222)).toBe('3 мин 42 сек')
    expect(formatDurationSeconds(0)).toBe('0 сек')
    expect(formatDurationSeconds(null)).toBe(EMPTY)
  })

  it('formats relative past and future', () => {
    expect(formatRelativeTime('2026-09-14T20:55:00Z', now)).toBe('5 мин назад')
    expect(formatRelativeTime('2026-09-15T16:00:00Z', now)).toBe('через 19 ч')
  })

  it('formats expiry around now', () => {
    expect(formatExpiry('2026-09-15T16:00:00Z', now)).toBe('Истекает через 19 ч')
  })

  it('shortens uuids', () => {
    expect(shortenId('f1a00000-0000-4000-8000-000000000001')).toBe('f1a00000…0001')
  })

  it('labels attempts', () => {
    expect(formatAttempts(1, 20)).toBe('1 из 20 попыток')
  })
})
