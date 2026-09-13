import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Observation as ObservationType, SourceStatus, Subscription } from '../../api/types'
import { formatTime } from '../../lib/format'
import { SubscriptionList } from './AccountSubscription'

afterEach(cleanup)

function observation(data: Subscription | null): ObservationType<Subscription> {
  return {
    source: 'core',
    observed_at: '2026-09-13T10:00:00Z',
    freshness: 'fresh',
    data,
  }
}

const active: Subscription = {
  plan: 'Профи',
  state: 'active',
  expires_at: '2026-10-13T10:00:00Z',
  capabilities: ['lead-status', 'activity'],
}

const unavailableSource: SourceStatus = {
  backend: 'core',
  status: 'unavailable',
  error: { code: 'backend_unavailable', message: 'нет ответа' },
}

describe('AccountSubscription', () => {
  it('renders an active subscription with plan, expiry and capabilities', () => {
    render(<SubscriptionList items={[observation(active)]} />)
    expect(screen.getByText('Профи')).toBeInTheDocument()
    const badge = screen.getByTestId('subscription-badge')
    expect(badge.textContent).toBe('Активна')
    expect(badge.className).toMatch(/ok/)
    expect(screen.getByText('источник: core')).toBeInTheDocument()
    expect(screen.getByText(/Действует до:/).textContent).toContain(formatTime(active.expires_at))
    expect(screen.getByText(/Возможности:/).textContent).toContain('lead-status, activity')
  })

  it('shows the raw backend state and a dash for a null expiry', () => {
    render(
      <SubscriptionList
        items={[
          observation({
            plan: 'Профи',
            state: 'unknown',
            raw: 'grace_period',
            expires_at: null,
            capabilities: [],
          }),
        ]}
      />,
    )
    const badge = screen.getByTestId('subscription-badge')
    expect(badge.textContent).toContain('Неизвестно')
    expect(badge.textContent).toContain('grace_period')
    expect(badge).toHaveAttribute('title', 'grace_period')
    expect(badge.className).not.toMatch(/ok/)
    expect(screen.getByText(/Действует до:/).textContent).toContain('—')
    expect(screen.getByText(/Возможности:/).textContent).toContain('—')
  })

  it('shows the source failure instead of the unknown card when facts are empty', () => {
    render(<SubscriptionList items={[]} sources={[unavailableSource]} />)
    expect(screen.getByText('Часть источников недоступна')).toBeInTheDocument()
    expect(screen.getByText('Источник недоступен')).toBeInTheDocument()
    expect(screen.getByText(/нет ответа/)).toBeInTheDocument()
    expect(screen.queryByText('Данные подписки недоступны')).not.toBeInTheDocument()
  })

  it('keeps the unknown card when no capable source failed and there are no facts', () => {
    render(<SubscriptionList items={[]} sources={[{ backend: 'core', status: 'available' }]} />)
    expect(screen.getByText('Данные подписки недоступны')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument()
    expect(screen.queryByText('Часть источников недоступна')).not.toBeInTheDocument()
  })

  it('renders available facts with the partial availability banner', () => {
    render(
      <SubscriptionList
        items={[observation(active)]}
        sources={[{ backend: 'core', status: 'available' }, unavailableSource]}
      />,
    )
    expect(screen.getByText('Профи')).toBeInTheDocument()
    expect(screen.getByText('Часть источников недоступна')).toBeInTheDocument()
    expect(screen.getByText(/нет ответа/)).toBeInTheDocument()
  })

  it('does not paint an expired subscription as ok', () => {
    render(<SubscriptionList items={[observation({ ...active, state: 'expired' })]} />)
    const badge = screen.getByTestId('subscription-badge')
    expect(badge.textContent).toBe('Истекла')
    expect(badge.className).toMatch(/error/)
    expect(badge.className).not.toMatch(/ok/)
  })
})
