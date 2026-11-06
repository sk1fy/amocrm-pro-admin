import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCrmUsers } from '../../api/queries'
import type { CrmUsers, Observation, SourceStatus } from '../../api/types'
import { AccountUsers, CrmUsersList } from './AccountUsers'

vi.mock('../../app/hooks', () => ({
  useRouteParams: () => ({ accountId: '91000001' }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
}))
vi.mock('../../api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/queries')>()),
  fetchCrmUsers: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.mocked(fetchCrmUsers).mockReset()
})

const connection = {
  id: 'f1a00000-0000-4000-8000-000000000001',
  integration_id: '11111111-1111-4111-8111-111111111111',
  integration_code: 'widget-fixture-a',
}

function observation(data: CrmUsers | null): Observation<CrmUsers> {
  return { source: 'core', observed_at: '2026-11-06T10:00:00Z', freshness: 'fresh', data }
}

function unknownList(state: string, extra: Partial<CrmUsers> = {}): CrmUsers {
  return {
    state,
    connection,
    fresh_until: null,
    retry_after_seconds: null,
    users: null,
    total: null,
    ...extra,
  }
}

const snapshot: CrmUsers = {
  state: 'ok',
  connection,
  fresh_until: '2026-11-06T10:05:00Z',
  retry_after_seconds: null,
  total: 2,
  users: [
    { id: 501, name: 'Fixture User A', is_active: true, is_admin: true },
    { id: 507, name: 'Fixture User G', is_active: false, is_admin: false },
  ],
}

describe('AccountUsers', () => {
  it('renders the snapshot with id, name, status, admin flag and connection', () => {
    render(<CrmUsersList accountId="91000001" items={[observation(snapshot)]} />)
    expect(screen.getByTestId('crm-users-state').textContent).toBe('Список получен')
    expect(screen.getByText('Всего: 2')).toBeInTheDocument()
    expect(screen.getByText('widget-fixture-a')).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    const first = within(rows[1])
    expect(first.getByText('501')).toBeInTheDocument()
    expect(first.getByText('Fixture User A')).toBeInTheDocument()
    expect(first.getByText('Активен')).toBeInTheDocument()
    expect(first.getByText('Да')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Неактивен')).toBeInTheDocument()
    expect(screen.queryByText(/Список пользователей неизвестен/)).toBeNull()
  })

  it('marks an already expired snapshot as stale and keeps its list', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-06T10:05:01Z'))
    render(<CrmUsersList accountId="91000001" items={[observation(snapshot)]} />)

    expect(screen.getByText('Данные устарели')).toBeInTheDocument()
    expect(screen.queryByText('Актуально')).not.toBeInTheDocument()
    expect(screen.getByText('Fixture User A')).toBeInTheDocument()
  })

  it('uses the snapshot deadline after the device clock moves back', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-06T10:04:59Z'))
    render(<CrmUsersList accountId="91000001" items={[observation(snapshot)]} />)

    vi.setSystemTime(new Date('2026-11-06T10:04:58Z'))
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(screen.getByText('Актуально')).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(screen.getByText('Данные устарели')).toBeInTheDocument()
  })

  it('shows an account without users as known and empty', () => {
    render(
      <CrmUsersList
        accountId="91000001"
        items={[observation({ ...snapshot, users: [], total: 0 })]}
      />,
    )
    expect(screen.getByText('В аккаунте нет пользователей')).toBeInTheDocument()
    expect(screen.queryByText(/Список пользователей неизвестен/)).toBeNull()
  })

  it.each([
    ['no_authorized_connection', 'Нет авторизованного подключения'],
    ['auth_error', 'amoCRM отклонила доступ'],
    ['incomplete', 'Список не получен целиком'],
    ['network_error', 'amoCRM не ответила'],
    ['internal_error', 'Ошибка чтения'],
  ])('keeps the list unknown for %s', (state, label) => {
    render(<CrmUsersList accountId="91000001" items={[observation(unknownList(state))]} />)
    expect(screen.getByTestId('crm-users-state').textContent).toBe(label)
    expect(screen.getByText('Список пользователей неизвестен')).toBeInTheDocument()
    expect(screen.queryByText('В аккаунте нет пользователей')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows the retry hint for a rate limit and the raw value of a new state', () => {
    render(
      <CrmUsersList
        accountId="91000001"
        items={[
          observation(unknownList('rate_limited', { retry_after_seconds: 30 })),
          { ...observation(unknownList('unknown', { raw: 'throttled' })), source: 'other' },
        ]}
      />,
    )
    expect(screen.getByText(/Повторите через 30 сек\./)).toBeInTheDocument()
    expect(screen.getByText('throttled')).toBeInTheDocument()
    expect(screen.getByText(/неизвестное состояние/)).toBeInTheDocument()
  })

  it('distinguishes no capable source from an unavailable one', () => {
    const { unmount } = render(<CrmUsersList accountId="91000001" items={[]} sources={[]} />)
    expect(screen.getByText('Данные о пользователях недоступны')).toBeInTheDocument()
    unmount()
    const unavailable: SourceStatus = {
      backend: 'core',
      status: 'unavailable',
      error: { code: 'backend_timeout', message: 'core request timed out' },
    }
    render(<CrmUsersList accountId="91000001" items={[]} sources={[unavailable]} />)
    expect(screen.getByText('Источник недоступен')).toBeInTheDocument()
    expect(screen.queryByText('В аккаунте нет пользователей')).toBeNull()
  })

  it('marks the mounted snapshot stale at its deadline without refetching', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-06T10:04:59Z'))
    vi.mocked(fetchCrmUsers).mockResolvedValue({
      items: [observation(snapshot)],
      sources: [{ backend: 'core', status: 'available' }],
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <AccountUsers />
      </QueryClientProvider>,
    )
    await act(() => vi.advanceTimersByTimeAsync(999))
    expect(screen.getByText('Актуально')).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(screen.getByText('Данные устарели')).toBeInTheDocument()
    expect(screen.queryByText('Актуально')).not.toBeInTheDocument()
    expect(screen.getByText('Fixture User A')).toBeInTheDocument()
    expect(fetchCrmUsers).toHaveBeenCalledTimes(1)
  })

  it('loads the account users through the Admin API', async () => {
    vi.mocked(fetchCrmUsers).mockResolvedValue({
      items: [observation(snapshot)],
      sources: [{ backend: 'core', status: 'available' }],
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <AccountUsers />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Fixture User A')).toBeInTheDocument()
    expect(fetchCrmUsers).toHaveBeenCalledWith('91000001')
    expect(screen.getByRole('heading', { name: 'Пользователи amoCRM' })).toBeInTheDocument()
  })
})
