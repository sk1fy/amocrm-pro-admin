import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchEmployees } from '../../api/queries'
import { EmployeesPage } from './EmployeesPage'

vi.mock('../../app/hooks', () => ({
  useRouteParams: () => ({}),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
  useRouterState: () => '/system/employees',
}))

vi.mock('../../api/queries', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/queries')>()
  return {
    ...original,
    fetchMe: vi.fn().mockResolvedValue({ id: 'employee-one', role: 'admin', permissions: [] }),
    fetchEmployees: vi.fn(),
  }
})

afterEach(() => {
  cleanup()
  vi.mocked(fetchEmployees).mockReset()
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EmployeesPage />
    </QueryClientProvider>,
  )
}

describe('EmployeesPage', () => {
  it('shows a page skeleton instead of a thin bar while loading', () => {
    vi.mocked(fetchEmployees).mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('Загрузка сотрудников…')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows an empty state when there are zero employees', async () => {
    vi.mocked(fetchEmployees).mockResolvedValue({ items: [] })
    renderPage()
    expect(await screen.findByText('Нет сотрудников')).toBeInTheDocument()
    expect(screen.getByText(/пока нет учётных записей/)).toBeInTheDocument()
  })

  it('shows error state with retry when the list fails', async () => {
    vi.mocked(fetchEmployees).mockRejectedValue(new Error('down'))
    renderPage()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
  })
})
