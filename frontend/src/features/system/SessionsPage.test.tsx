import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fetchSessions } from '../../api/queries'
import { SessionsPage } from './SessionsPage'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
  useRouterState: () => '/system/sessions',
}))

beforeAll(() => {
  if (typeof HTMLDialogElement === 'undefined') {
    return
  }
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open')
  }
})

vi.mock('../../api/queries', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/queries')>()
  return {
    ...original,
    fetchMe: vi.fn().mockResolvedValue({ id: 'employee-one', role: 'operator', permissions: [] }),
    fetchSessions: vi.fn(),
    revokeSession: vi.fn(),
  }
})

afterEach(() => {
  cleanup()
  vi.mocked(fetchSessions).mockReset()
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionsPage />
    </QueryClientProvider>,
  )
}

describe('SessionsPage', () => {
  it('opens a confirmation dialog before revoke and does not revoke from the row', async () => {
    vi.mocked(fetchSessions).mockResolvedValue({
      items: [
        {
          id: 'session-one',
          created_at: '2026-09-14T10:00:00Z',
          last_seen_at: '2026-09-14T11:00:00Z',
          expires_at: '2026-09-15T10:00:00Z',
          ip: '127.0.0.1',
        },
      ],
    })
    renderPage()
    expect(await screen.findByRole('button', { name: 'Отозвать…' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Отозвать…' }))
    expect(screen.getByRole('heading', { name: 'Отозвать сессию' })).toBeInTheDocument()
    expect(screen.getByText(/сразу станет недействительной/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отозвать' })).toBeInTheDocument()
  })
})
