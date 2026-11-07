import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAdminOperation, fetchConnection } from '../../api/queries'
import type { AdminOperation, ConnectionCard } from '../../api/types'
import { connectionCommand } from '../operations/commands'
import { intentStorageKey, writeIntent } from '../operations/intents'
import { ConnectionPage } from './ConnectionPage'

const routeSearch = vi.hoisted(() => ({ value: {} as { section?: string } }))

vi.mock('../../app/hooks', () => ({
  useRouteParams: () => ({
    accountId: '91000001',
    backend: 'core',
    connectionId: 'connection-one',
  }),
  useRouteSearch: () => routeSearch.value,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
    title,
    'aria-label': ariaLabel,
  }: {
    children?: ReactNode
    className?: string
    title?: string
    'aria-label'?: string
  }) => (
    <a href="/" className={className} title={title} aria-label={ariaLabel}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}))

const timestamp = '2026-11-01T10:00:00Z'

const observation = vi.hoisted(
  () =>
    (data: unknown, freshness = 'fresh') =>
      ({ source: 'core', observed_at: '2026-11-01T10:00:00Z', freshness, data }) as const,
)

vi.mock('../../api/queries', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/queries')>()
  return {
    ...original,
    fetchConnection: vi.fn(),
    fetchAccount: vi.fn().mockResolvedValue({
      account_id: '91000001',
      domains: ['fixture-one.amocrm.test'],
      state: 'attention',
      problems: [],
      origin: 'fixture',
      connections: [
        observation({
          backend: 'core',
          connection_id: 'connection-one',
          integration_code: 'fixture-widget-a',
          state: 'active',
        }),
        observation({
          backend: 'core',
          connection_id: 'connection-two',
          integration_code: 'fixture-widget-b',
          state: 'active',
        }),
      ],
      sources: [],
    }),
    fetchBackends: vi.fn().mockResolvedValue({ items: [], observability: {} }),
    fetchMe: vi.fn().mockResolvedValue({
      id: 'employee-one',
      permissions: ['connections:check', 'connections:disable', 'webhooks:reconcile'],
    }),
    fetchAdminOperation: vi.fn(),
    fetchAdminOperations: vi.fn().mockResolvedValue({ items: [] }),
  }
})

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  routeSearch.value = {}
  vi.mocked(fetchConnection).mockReset()
  vi.mocked(fetchAdminOperation).mockReset()
})

function card(overrides: Partial<ConnectionCard> = {}): ConnectionCard {
  return {
    backend: 'core',
    connection: observation({
      id: 'connection-one',
      account_id: '91000001',
      integration_id: 'integration-one',
      integration_code: 'fixture-widget-a',
      account_domain: 'fixture-one.amocrm.test',
      state: 'active',
      origin: 'fixture',
      created_at: timestamp,
      updated_at: timestamp,
    }),
    authorization: observation({
      state: 'valid',
      credentials_present: true,
      unverified: false,
      lease_active: false,
      expires_at: '2026-11-08T10:00:00Z',
    }),
    authorization_check: observation({ classification: 'verified_ok', observed_at: timestamp }),
    webhook: observation({
      status: 'active',
      events: ['add_lead'],
      checked_at: timestamp,
      confirmed_destinations: 2,
    }),
    grants: observation([]),
    activity: observation({ pilot: 'enabled', deliveries: [] }),
    activity_sync: observation({ state: 'idle', reauth_required: false, lag_seconds: 0 }),
    recent_jobs: observation([]),
    recent_audit: observation([]),
    ...overrides,
  } as ConnectionCard
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ConnectionPage />
    </QueryClientProvider>,
  )
}

describe('connection page (ADR-0021)', () => {
  it('renders one header with the account context and no freshness noise', async () => {
    routeSearch.value = { section: 'auth' }
    vi.mocked(fetchConnection).mockResolvedValue(card())
    renderPage()

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Подключение fixture-widget-a',
    })
    const header = heading.closest('header') as HTMLElement
    expect(within(header).getByRole('link', { name: 'fixture-one.amocrm.test' })).toBeVisible()
    expect(within(header).getByText('ID 91000001')).toBeVisible()
    expect(within(header).getByText('тестовые данные')).toBeVisible()
    expect(within(header).getByText('Работает')).toBeVisible()
    expect(within(header).getByLabelText('Другие подключения аккаунта')).toBeVisible()
    expect(within(header).getByRole('link', { name: 'Следующее подключение' })).toBeVisible()

    expect(screen.getByText('Активных проблем нет.')).toBeVisible()
    expect(screen.queryByText('Актуально')).toBeNull()
    expect(screen.queryByText(/источник:/)).toBeNull()
    expect(screen.queryByText('реальные данные')).toBeNull()
    expect(screen.getByText('Локальная авторизация')).toHaveAttribute(
      'title',
      expect.stringContaining('источник: core'),
    )
  })

  it('keeps problems, stale and unknown states visible', async () => {
    vi.mocked(fetchConnection).mockResolvedValue(
      card({
        authorization_check: observation(
          { classification: 'verified_ok', observed_at: timestamp },
          'stale',
        ),
        activity_sync: observation(null, 'unknown'),
      } as Partial<ConnectionCard>),
    )
    renderPage()

    const header = (await screen.findByRole('heading', { level: 1 })).closest(
      'header',
    ) as HTMLElement
    expect(within(header).getByText('Работает с предупреждениями')).toBeVisible()
    const summary = screen.getByRole('region', { name: 'Состояние подключения' })
    expect(within(summary).getByText('Проверка amoCRM устарела')).toBeVisible()
    const facets = within(summary).getByRole('navigation', { name: 'Сводка здоровья' })
    expect(within(facets).getByRole('link', { name: /Синхронизация/ })).toHaveTextContent(
      'Неизвестно',
    )
    expect(screen.getByText('Данные устарели')).toBeVisible()
    expect(screen.getByText('Требуется повторная проверка')).toBeVisible()
  })

  it('keeps the action bar in one row and shows command results under it', async () => {
    const spec = connectionCommand('core', 'connection-one', 'check', '91000001')
    writeIntent(intentStorageKey('employee-one', spec.path), {
      requestKey: 'request-one',
      operationId: 'operation-check',
    })
    const operation: AdminOperation = {
      id: 'operation-check',
      employee_id: 'employee-one',
      backend: 'core',
      target_type: 'installation',
      target_id: 'connection-one',
      command: 'check',
      state: 'succeeded',
      result: { classification: 'verified_ok', observed_at: timestamp, job_id: 'job-one' },
      created_at: timestamp,
      updated_at: timestamp,
    }
    vi.mocked(fetchAdminOperation).mockResolvedValue({ operation })
    vi.mocked(fetchConnection).mockResolvedValue(card())
    renderPage()

    const result = await screen.findByRole('region', { name: 'Результат операции' })
    const bar = screen.getByRole('group', { name: 'Действия с подключением' })
    expect(within(bar).getByRole('button', { name: 'Проверить подключение' })).toBeVisible()
    expect(within(bar).getByRole('button', { name: 'Отключить подключение' })).toBeVisible()
    expect(within(bar).queryByRole('button', { name: 'Восстановить webhook' })).toBeNull()
    expect(bar).not.toContainElement(result)
    expect(within(result).getByText('Подробности выполнения')).toBeVisible()
    expect(within(result).getByText('Задача: job-one')).not.toBeVisible()
    expect(screen.queryByRole('button', { name: 'Проверить объект' })).toBeNull()
  })
})
