import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VerificationBadge } from './VerificationBadge'

describe('verification labels', () => {
  it.each([
    ['verified_ok', 'fresh', 'Проверка amoCRM успешна'],
    ['verified_ok', 'stale', 'Проверка устарела'],
    ['unknown', 'unknown', 'Доступ не проверен'],
    ['network_error', 'unavailable', 'Ошибка сети при проверке'],
    ['auth_error', 'fresh', 'Ошибка авторизации amoCRM'],
  ])('%s/%s shows an explicit text label', (classification, freshness, text) => {
    render(
      <VerificationBadge
        verification={{
          classification,
          freshness,
          observed_at: '2026-09-19T12:00:00Z',
          fresh_for_seconds: 5400,
        }}
      />,
    )
    expect(screen.getByText(text)).toBeInTheDocument()
    if (freshness !== 'fresh')
      expect(screen.queryByText('Проверка amoCRM успешна')).not.toBeInTheDocument()
  })
  it('unavailable source overrides a saved successful check', () => {
    render(
      <VerificationBadge
        unavailable
        verification={{
          classification: 'verified_ok',
          freshness: 'fresh',
          fresh_for_seconds: 5400,
        }}
      />,
    )
    expect(screen.getByText('Источник недоступен')).toBeInTheDocument()
  })
})
