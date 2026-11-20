import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resetApiSession } from '../src/api/client'
import { ManagerApp } from './ManagerApp'
import { parseWorkflowMetadata } from './companyApi'

const product = '10f803ed-c6f3-48db-ae9f-26ab8e81f3c1'
const generation = '20f803ed-c6f3-48db-ae9f-26ab8e81f3c1'
const receipt = '30f803ed-c6f3-48db-ae9f-26ab8e81f3c1'
const time = '2026-11-17T10:00:00Z'
const source = {
  source_account_id: '71',
  binding_revision: 'fixture-v1',
  state: 'fresh',
  complete: true,
  observed_at: time,
  fresh_until: '2027-11-17T10:00:00Z',
  error_code: null,
  retry_at: null,
}
const metadata = {
  generation_id: generation,
  source,
  pipelines: [
    { id: '11', name: 'Продажи', stages: [{ id: '12', name: 'Новый' }] },
    { id: '21', name: 'Повтор', stages: [{ id: '22', name: 'Повторный' }] },
  ],
  required_fields_state: 'unknown',
  write_ready: false,
  sources: [],
  observation: {},
}
const absent = { version: 1, configuration: null }

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
})
function open(
  search: string,
  grants: string[],
  handler: (url: URL, init?: RequestInit) => Response,
) {
  window.history.replaceState(null, '', '/managers?' + search)
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const parsed = new URL(String(url), window.location.origin)
      if (parsed.pathname.endsWith('/me'))
        return Response.json({
          id: receipt,
          name: 'Менеджер',
          email: 'fixture@example.invalid',
          grants,
        })
      return handler(parsed, init)
    }),
  )
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ManagerApp />
    </QueryClientProvider>,
  )
}
afterEach(() => {
  resetApiSession()
  vi.unstubAllGlobals()
})
it('opens shared settings from installations with catalog.manage, clears stage on pipeline change, and retains exact unknown command', async () => {
  const requests: { body: RequestInit['body']; key: string | null; version: string | null }[] = []
  let committed = false
  const saved = {
    version: 2,
    configuration: {
      revision: 1,
      source_account_id: '71',
      binding_revision: 'fixture-v1',
      metadata_generation_id: generation,
      pipeline_id: '21',
      initial_stage_id: '22',
      validated_at: time,
    },
  }
  open('section=installations', ['catalog.manage'], (url, init) => {
    if (url.pathname.endsWith('/company-workflow-metadata')) return Response.json(metadata)
    if (url.pathname.includes('/operations/')) {
      committed = true
      return Response.json({ id: receipt, state: 'completed' })
    }
    expect(url.pathname).toBe('/api/v1/managers/installation-deal-settings')
    if (init?.method === 'PUT') {
      requests.push({
        body: init.body,
        key: new Headers(init.headers).get('Idempotency-Key'),
        version: new Headers(init.headers).get('If-Match'),
      })
      if (!committed)
        return Response.json({ id: receipt, state: 'unknown_outcome' }, { status: 202 })
      return Response.json(saved, { headers: { ETag: '"2"' } })
    }
    return committed
      ? Response.json(saved, { headers: { ETag: '"2"' } })
      : Response.json(absent, { headers: { ETag: '"1"' } })
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Настройка сделок' }))
  const pipeline = await screen.findByLabelText('Воронка'),
    stage = screen.getByLabelText('Начальный этап')
  await waitFor(() => expect(pipeline).toBeEnabled())
  fireEvent.change(pipeline, { target: { value: '11' } })
  fireEvent.change(stage, { target: { value: '12' } })
  fireEvent.change(pipeline, { target: { value: '21' } })
  expect(stage).toHaveValue('')
  fireEvent.change(stage, { target: { value: '22' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройку' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Проверить результат' }))
  await screen.findByText('Сохранено.')
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
  expect(requests[0].version).toBe('"1"')
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Настройка сделок' }))
  expect(await screen.findByLabelText('Воронка')).toHaveValue('21')
  expect(screen.getByLabelText('Начальный этап')).toHaveValue('22')
  expect(
    within(screen.getByRole('navigation', { name: 'Кабинет менеджеров' }))
      .getAllByRole('link')
      .map((link) => link.getAttribute('aria-label')),
  ).toEqual(['Установки', 'Клиенты', 'Виджеты', 'Лента событий', 'Сотрудники'])
})
it('preserves the draft on metadata assertion conflict and explicitly creates a new command', async () => {
  let changed = false
  const keys: (string | null)[] = []
  open('section=installations', ['catalog.manage'], (url, init) => {
    if (url.pathname.endsWith('/company-workflow-metadata'))
      return Response.json({ ...metadata, generation_id: changed ? receipt : generation })
    if (init?.method === 'PUT') {
      keys.push(new Headers(init.headers).get('Idempotency-Key'))
      if (keys.length === 1) {
        changed = true
        return Response.json(
          { error: { code: 'conflict', details: { code: 'company_metadata_conflict' } } },
          { status: 409 },
        )
      }
      return Response.json(
        {
          version: 2,
          configuration: {
            revision: 1,
            source_account_id: '71',
            binding_revision: 'fixture-v1',
            metadata_generation_id: receipt,
            pipeline_id: '11',
            initial_stage_id: '12',
            validated_at: time,
          },
        },
        { headers: { ETag: '"2"' } },
      )
    }
    return Response.json(absent, { headers: { ETag: '"1"' } })
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Настройка сделок' }))
  const pipeline = await screen.findByLabelText('Воронка')
  await waitFor(() => expect(pipeline).toBeEnabled())
  fireEvent.change(pipeline, { target: { value: '11' } })
  fireEvent.change(screen.getByLabelText('Начальный этап'), { target: { value: '12' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройку' }))
  const rebase = await screen.findByRole('button', { name: 'Применить черновик к текущей версии' })
  await waitFor(() => expect(rebase).toBeEnabled())
  expect(pipeline).toHaveValue('11')
  expect(screen.getByLabelText('Начальный этап')).toHaveValue('12')
  fireEvent.click(rebase)
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройку' }))
  await screen.findByText('Сохранено.')
  expect(keys).toHaveLength(2)
  expect(keys[1]).not.toBe(keys[0])
})
it('does not request or display deal settings in individual widget cards', async () => {
  const api = vi.fn(() => Response.json({}, { status: 404 }))
  open('section=widgets&product=' + product, ['catalog.manage'], api)
  await screen.findByText('Нет доступа к карточке каталога.')
  expect(screen.queryByRole('button', { name: 'Настройка сделок' })).toBeNull()
  expect(screen.queryByLabelText('Воронка')).toBeNull()
  expect(api).not.toHaveBeenCalled()
})
it('rejects numeric CRM IDs in workflow metadata', () => {
  expect(() =>
    parseWorkflowMetadata({ ...metadata, source: { ...source, source_account_id: 71 } }),
  ).toThrow()
})
