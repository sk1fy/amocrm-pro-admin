import { describe, expect, it } from 'vitest'
import { connectionsCountLabel, plural } from './accountText'

describe('accountText', () => {
  it('chooses Russian plural forms', () => {
    const forms = (n: number) => plural(n, 'аккаунт', 'аккаунта', 'аккаунтов')
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111].map(forms)).toEqual([
      'аккаунт',
      'аккаунта',
      'аккаунтов',
      'аккаунтов',
      'аккаунтов',
      'аккаунт',
      'аккаунта',
      'аккаунтов',
      'аккаунтов',
    ])
  })

  it('names an empty account explicitly instead of a zero', () => {
    expect(connectionsCountLabel(0)).toBe('нет подключений')
    expect(connectionsCountLabel(3)).toBe('3 подключения')
  })
})
