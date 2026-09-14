import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchBackends } from '../../api/queries'
import type { BackendRegistryEntry } from '../../api/types'
import { SettingsPage } from './SettingsPage'

vi.mock('../../app/hooks', () => ({
  useRouteParams: () => ({ accountId: '91000001', backend: 'fixture', connectionId: 'f1' }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
}))

const observation = vi.hoisted(
  () => (data: unknown) =>
    ({
      source: 'fixture',
      observed_at: '2026-09-13T10:00:00Z',
      freshness: 'fresh',
      data,
    }) as const,
)

vi.mock('../../api/queries', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/queries')>()
  return {
    ...original,
    fetchBackends: vi.fn(),
    fetchMe: vi.fn().mockResolvedValue({ id: 'employee-one', permissions: [] }),
    fetchActivitySettings: vi.fn().mockResolvedValue(
      observation({
        initial_days: 2,
        retention_days: 7,
        updated_at: '2026-09-13T10:00:00Z',
      }),
    ),
    fetchActivityStatus: vi.fn().mockResolvedValue(
      observation({
        state: 'idle',
        reauth_required: false,
        last_success_at: '2026-09-13T10:00:00Z',
      }),
    ),
    fetchActivityPanels: vi.fn().mockResolvedValue(observation([])),
    fetchActivityEmployees: vi.fn().mockResolvedValue(observation([])),
    fetchLeadStatusRules: vi.fn().mockResolvedValue(observation([])),
    fetchLeadStatusRuns: vi.fn().mockResolvedValue(observation({ items: [] })),
  }
})

afterEach(() => {
  cleanup()
  vi.mocked(fetchBackends).mockReset()
})

function entry(overrides: Partial<BackendRegistryEntry> = {}): BackendRegistryEntry {
  return {
    backend: 'fixture',
    kind: 'fixture',
    display_name: 'Fixture module',
    products: [{ code: 'fixture-module', display_name: 'Демонстрационный модуль' }],
    status: 'available',
    contract_version: 'v1',
    revision: 'fixture',
    adapter_capabilities: ['accounts', 'connections'],
    backend_capabilities: ['accounts'],
    observed_at: '2026-09-13T10:00:00Z',
    checked_at: '2026-09-13T10:05:00Z',
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  )
}

describe('SettingsPage dispatcher', () => {
  it('renders the activity module for a backend that declares its products', async () => {
    vi.mocked(fetchBackends).mockResolvedValue({
      items: [
        entry({
          products: [{ code: 'activity', display_name: 'Активность сотрудников' }],
          adapter_capabilities: ['accounts', 'settings'],
        }),
      ],
      observability: {},
    })
    renderPage()
    expect(
      await screen.findByRole('heading', { name: 'Настройки Activity и lead-status' }),
    ).toBeInTheDocument()
    expect(await screen.findByTestId('retention-days')).toHaveTextContent('7')
    expect(await screen.findByText('Нет сотрудников')).toBeInTheDocument()
  })

  it('does not dispatch to the activity module without the settings capability', async () => {
    vi.mocked(fetchBackends).mockResolvedValue({
      items: [
        entry({
          products: [{ code: 'activity', display_name: 'Активность сотрудников' }],
          adapter_capabilities: ['accounts'],
        }),
      ],
      observability: {},
    })
    renderPage()
    expect(await screen.findByText('Для этого модуля настройки недоступны.')).toBeInTheDocument()
    expect(screen.queryByTestId('retention-days')).not.toBeInTheDocument()
  })

  it('explains that settings are unavailable without an error or retry loop', async () => {
    vi.mocked(fetchBackends).mockResolvedValue({ items: [entry()], observability: {} })
    renderPage()
    expect(await screen.findByText('Для этого модуля настройки недоступны.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument()
  })

  it('shows the standard error state with retry when the registry query fails', async () => {
    vi.mocked(fetchBackends).mockRejectedValue(new Error('registry down'))
    renderPage()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
  })

  it('shows a skeleton while the registry is loading', () => {
    vi.mocked(fetchBackends).mockReturnValue(new Promise(() => {}))
    const { container } = renderPage()
    expect(container.querySelector('[class*="skeleton"]')).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'Настройки Activity и lead-status' })).toBeNull()
  })
})
