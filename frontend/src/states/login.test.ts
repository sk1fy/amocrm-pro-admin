import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { loginErrorMessage } from './login'

describe('login errors', () => {
  it('keeps credential failures uniform', () => {
    expect(loginErrorMessage(new ApiError(401, 'unauthenticated', 'hidden', 'id'))).toBe(
      'Неверный email или пароль',
    )
  })
  it('distinguishes rate limiting', () => {
    expect(loginErrorMessage(new ApiError(429, 'rate_limited', 'hidden', 'id'))).toContain(
      'Слишком много попыток',
    )
  })
  it.each([500, 502, 503, 504])('shows safe availability message for %s', (status) => {
    const text = loginErrorMessage(
      new ApiError(status, 'internal', 'private database detail', 'request-id'),
    )
    expect(text).toContain('временно недоступен')
    expect(text).toContain('request-id')
    expect(text).not.toContain('private database detail')
  })
  it('shows availability message for network failure', () => {
    expect(loginErrorMessage(new TypeError('Failed to fetch'))).toContain('временно недоступен')
  })
})
