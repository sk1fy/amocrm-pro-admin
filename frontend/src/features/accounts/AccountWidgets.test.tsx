import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAccount } from '../../api/queries'
import type { AccountCard, AccountConnectionCard, Observation } from '../../api/types'
import { AccountWidgets } from './AccountWidgets'

vi.mock('../../app/hooks', () => ({
  useRouteParams: () => ({ accountId: '91000001' }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
}))
vi.mock('../../api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/queries')>()),
  fetchAccount: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.mocked(fetchAccount).mockReset()
})

function connection(overrides: Partial<AccountConnectionCard> = {}): AccountConnectionCard {
  return {
    backend: 'core',
    connection_id: 'fixture-installation',
    integration_code: 'fixture-activity',
    state: 'active',
    authorization: { state: 'valid', unverified: false },
    webhook: { status: 'active' },
    grants: [{ service: 'activity', state: 'granted' }],
    activity: { pilot: 'enabled' },
    ...overrides,
  }
}
function renderAccount(
  data: AccountConnectionCard | null,
  freshness: Observation<AccountConnectionCard>['freshness'] = 'fresh',
) {
  const account: AccountCard = {
    account_id: '91000001',
    domains: ['fixture.amocrm.test'],
    state: 'ok',
    problems: [],
    origin: 'fixture',
    connections: [{ source: 'core', observed_at: '2026-10-27T10:00:00Z', freshness, data }],
    sources: [{ backend: 'core', status: 'available' }],
  }
  vi.mocked(fetchAccount).mockResolvedValue(account)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AccountWidgets />
    </QueryClientProvider>,
  )
}

describe('Activity MVP registration', () => {
  it('shows product, installation, OAuth and pilot separately', async () => {
    renderAccount(connection())
    expect(await screen.findByText('Контроль активности 2.0')).toHaveAttribute('title', 'activity')
    expect(screen.getByText('fixture-activity')).toBeInTheDocument()
    expect(screen.getByTestId('connection-badge')).toHaveTextContent('Активно')
    expect(screen.getByText('Пилот включён')).toBeInTheDocument()
    expect(screen.getByText('Действует')).toBeInTheDocument()
  })

  it('keeps the product visible when its grant and pilot are disabled', async () => {
    renderAccount(
      connection({
        grants: [{ service: 'activity', state: 'not_granted' }],
        activity: { pilot: 'disabled' },
      }),
    )
    expect(await screen.findByText('Контроль активности 2.0')).toBeInTheDocument()
    expect(screen.getByText('Не выдан')).toBeInTheDocument()
    expect(screen.getByText('Пилот выключен')).toBeInTheDocument()
    expect(screen.getByTestId('connection-badge')).toHaveTextContent('Активно')
  })

  it('does not infer a product from a matching integration code without grants', async () => {
    renderAccount(connection({ integration_code: 'activity', grants: [], activity: undefined }))
    expect(await screen.findByText('Нет грантов')).toBeInTheDocument()
    expect(screen.queryByText('Контроль активности 2.0')).not.toBeInTheDocument()
    expect(screen.queryByText('Пилот не настроен')).not.toBeInTheDocument()
    const row = screen.getAllByRole('row')[1]
    expect(within(row).getByText('Неизвестно')).toBeInTheDocument()
  })

  it('distinguishes missing grants from a confirmed empty list', async () => {
    renderAccount(connection({ grants: undefined }))
    await screen.findByText('fixture-activity')
    expect(screen.getByText('Нет данных')).toBeInTheDocument()
    expect(screen.queryByText('Нет грантов')).not.toBeInTheDocument()
  })

  it('does not display cached product or pilot facts when the source is unavailable', async () => {
    renderAccount(connection(), 'unavailable')
    await screen.findByText('fixture-activity')
    expect(screen.getAllByText('Источник недоступен').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('Контроль активности 2.0')).not.toBeInTheDocument()
    expect(screen.queryByText('Пилот включён')).not.toBeInTheDocument()
    expect(screen.queryByText('Нет грантов')).not.toBeInTheDocument()
  })
})
