import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Integration } from '../../api/types'
import { IntegrationCommands } from './IntegrationCommands'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
}))

vi.mock('../../api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/queries')>()),
  fetchMe: vi.fn().mockResolvedValue({
    id: 'admin',
    name: 'Admin',
    email: 'admin@example.invalid',
    role: 'admin',
    permissions: [
      'integrations:write',
      'integrations:rotate_secret',
      'integrations:enable',
      'integrations:disable',
    ],
  }),
  fetchCatalog: vi.fn().mockResolvedValue({ backends: [], products: [] }),
}))

afterEach(cleanup)

function integration(state: string): Integration {
  return {
    backend: 'core',
    id: 'integration-one',
    code: 'fixture-widget',
    client_id: 'fixture-client',
    redirect_uri: 'https://fixture.example.invalid/callback',
    state,
    webhook_events: [],
    created_at: '2026-09-14T10:00:00Z',
    updated_at: '2026-09-14T10:00:00Z',
    key_version: 1,
    grants: [],
    installations_by_status: {},
  }
}

function renderCommands(state: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <IntegrationCommands item={integration(state)} onInspect={() => undefined} />
    </QueryClientProvider>,
  )
}

describe('IntegrationCommands', () => {
  it('offers only the toggle that applies and folds rare commands into «Ещё»', async () => {
    const { container } = renderCommands('active')
    expect(await screen.findByRole('button', { name: 'Изменить параметры' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отключить интеграцию' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Включить интеграцию' })).not.toBeInTheDocument()
    const menu = container.querySelector('details') as HTMLDetailsElement
    expect(menu.querySelector('summary')?.textContent).toBe('Ещё')
    expect(menu.textContent).toContain('Заменить секрет')
    expect(menu.textContent).toContain('Настроить сервис')
    expect(menu.textContent).toContain('История команд интеграции')
  })

  it('offers enabling for a disabled integration', async () => {
    renderCommands('disabled')
    expect(await screen.findByRole('button', { name: 'Включить интеграцию' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Отключить интеграцию' })).not.toBeInTheDocument()
  })
})
