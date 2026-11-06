import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Job } from '../../api/types'
import { jobDurationLabel, jobShowsAttempts, jobShowsError, JobsTable } from './JobsTable'
import { jobTitle } from './jobText'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, title }: { children?: ReactNode; title?: string }) => (
    <a href="/" title={title}>
      {children}
    </a>
  ),
}))

vi.mock('../../api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/queries')>()),
  fetchMe: vi.fn().mockResolvedValue({ id: 'viewer', role: 'viewer', permissions: [] }),
  fetchJob: vi.fn().mockReturnValue(new Promise(() => {})),
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

afterEach(cleanup)

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    type: 'webhook.reconcile',
    status: 'completed',
    priority: 1,
    attempts: 1,
    max_attempts: 3,
    run_after: '2026-09-14T10:00:00Z',
    created_at: '2026-09-14T10:00:00Z',
    updated_at: '2026-09-14T10:00:02Z',
    ...overrides,
  }
}

function renderTable(rows: Job[], widgetNames?: Map<string, string>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <JobsTable
        rows={rows.map((item) => ({ job: item, backend: 'core' }))}
        accountId="91000002"
        widgetNames={widgetNames}
      />
    </QueryClientProvider>,
  )
}

describe('JobsTable helpers', () => {
  it('hides attempts and errors for successful jobs', () => {
    expect(jobShowsAttempts('completed')).toBe(false)
    expect(jobShowsError('completed')).toBe(false)
    expect(jobShowsAttempts('failed')).toBe(true)
    expect(jobShowsError('dead')).toBe(true)
    expect(jobShowsAttempts('processing')).toBe(true)
  })

  it('computes duration from created_at and finished_at', () => {
    expect(
      jobDurationLabel(
        job({ created_at: '2026-09-14T10:00:00Z', finished_at: '2026-09-14T10:02:00Z' }),
      ),
    ).toBe('2 мин')
    expect(jobDurationLabel(job({ finished_at: null }))).toBe('—')
  })

  it('names known job types and keeps the code of unknown ones', () => {
    expect(jobTitle('webhook.reconcile')).toBe('Восстановление webhook')
    expect(jobTitle('distribution.normalize_event')).toBe('Разбор события распределения')
    expect(jobTitle('custom.unknown_job')).toBe('custom.unknown_job')
    expect(jobTitle('')).toBe('—')
  })
})

describe('JobsTable', () => {
  it('shows a calm list without service columns when every job succeeded', () => {
    renderTable(
      [job({ installation_id: 'connection-one' })],
      new Map([['connection-one', 'widget-a']]),
    )
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual(['Задача', 'Статус', 'Виджет', 'Длительность', 'Обновлено'])
    expect(screen.queryByRole('button', { name: 'Подробнее' })).not.toBeInTheDocument()
    expect(screen.getByText('Восстановление webhook').closest('td')).toHaveAttribute(
      'title',
      'webhook.reconcile',
    )
    expect(screen.queryByText('webhook.reconcile')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'widget-a' })).toBeInTheDocument()
  })

  it('adds attempts and error columns only when a job failed', () => {
    renderTable([
      job({ id: 'ok-job' }),
      job({
        id: 'failed-job',
        status: 'failed',
        attempts: 2,
        max_attempts: 5,
        last_error_message: 'Источник не ответил',
        installation_id: 'unknown-connection',
      }),
    ])
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toContain('Попытки')
    expect(headers).toContain('Ошибка')
    const failedRow = screen.getByText('Источник не ответил').closest('tr') as HTMLElement
    expect(within(failedRow).getByText('2/5')).toBeInTheDocument()
    expect(within(failedRow).getByRole('link', { name: 'Подключение' })).toBeInTheDocument()
  })

  it('opens the job card from the row', () => {
    renderTable([job({ status: 'failed', last_error_message: 'Источник не ответил' })])
    fireEvent.click(screen.getByText('Восстановление webhook'))
    const drawer = screen.getByRole('dialog', { name: 'Восстановление webhook' })
    expect(within(drawer).getByText('Технические данные')).toBeInTheDocument()
    expect(within(drawer).getByText('Попытки выполнения')).toBeInTheDocument()
  })
})
