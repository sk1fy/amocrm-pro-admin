import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { resetApiSession } from '../src/api/client'
import { ManagerApp } from './ManagerApp'
import { parseCompanyList, parseWorkflowMetadata } from './companyApi'

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
const absent = { product_id: product, version: 1, configuration: null, write_ready: false }
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
it('separates absent snapshots from complete empty data and rejects numeric CRM IDs', () => {
  expect(
    parseCompanyList({
      items: null,
      next_cursor: null,
      source: { ...source, state: 'error', complete: false, observed_at: null, fresh_until: null },
      sources: [],
      observation: {},
    }).items,
  ).toBeNull()
  expect(
    parseCompanyList({ items: [], next_cursor: null, source, sources: [], observation: {} }).items,
  ).toEqual([])
  expect(() =>
    parseWorkflowMetadata({ ...metadata, source: { ...source, source_account_id: 71 } }),
  ).toThrow()
})
it('uses catalog-only workflow, clears stage on pipeline change, and retains exact unknown command', async () => {
  const requests: { body: RequestInit['body']; key: string | null; version: string | null }[] = []
  let committed = false
  open('section=widgets&product=' + product, ['catalog.manage'], (url, init) => {
    if (url.pathname.endsWith('/company-workflow-metadata')) return Response.json(metadata)
    if (url.pathname.includes('/operations/')) {
      committed = true
      return Response.json({ id: receipt, state: 'completed' })
    }
    expect(url.pathname).toBe('/api/v1/managers/products/' + product + '/company-workflow')
    if (init?.method === 'PUT') {
      requests.push({
        body: init.body,
        key: new Headers(init.headers).get('Idempotency-Key'),
        version: new Headers(init.headers).get('If-Match'),
      })
      if (!committed)
        return Response.json({ id: receipt, state: 'unknown_outcome' }, { status: 202 })
      return Response.json(
        {
          product_id: product,
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
          write_ready: false,
        },
        { headers: { ETag: '"2"' } },
      )
    }
    return Response.json(absent, { headers: { ETag: '"1"' } })
  })
  const pipeline = await screen.findByLabelText('Воронка'),
    stage = screen.getByLabelText('Начальный этап')
  await waitFor(() => expect(pipeline).toBeEnabled())
  fireEvent.change(pipeline, { target: { value: '11' } })
  fireEvent.change(stage, { target: { value: '12' } })
  fireEvent.change(pipeline, { target: { value: '21' } })
  expect(stage).toHaveValue('')
  fireEvent.change(stage, { target: { value: '22' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройку CRM' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Проверить результат' }))
  await screen.findByText('Сохранено.')
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
  expect(requests[0].version).toBe('"1"')
  expect(
    within(screen.getByRole('navigation', { name: 'Кабинет менеджеров' }))
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(['Установки', 'Клиенты', 'Виджеты', 'Лента событий', 'Сотрудники'])
})
it('preserves the draft on metadata assertion conflict and explicitly creates a new command', async () => {
  let changed = false
  const keys: (string | null)[] = []
  open('section=widgets&product=' + product, ['catalog.manage'], (url, init) => {
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
          product_id: product,
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
          write_ready: false,
        },
        { headers: { ETag: '"2"' } },
      )
    }
    return Response.json(absent, { headers: { ETag: '"1"' } })
  })
  const pipeline = await screen.findByLabelText('Воронка')
  await waitFor(() => expect(pipeline).toBeEnabled())
  fireEvent.change(pipeline, { target: { value: '11' } })
  fireEvent.change(screen.getByLabelText('Начальный этап'), { target: { value: '12' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройку CRM' }))
  const rebase = await screen.findByRole('button', { name: 'Применить черновик к текущей версии' })
  await waitFor(() => expect(rebase).toBeEnabled())
  expect(pipeline).toHaveValue('11')
  expect(screen.getByLabelText('Начальный этап')).toHaveValue('12')
  fireEvent.click(rebase)
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройку CRM' }))
  await screen.findByText('Сохранено.')
  expect(keys).toHaveLength(2)
  expect(keys[1]).not.toBe(keys[0])
})
it('shows an unmapped company with M:N and dangling links without inventing runtime accounts', async () => {
  open('section=clients&clients_tab=companies&company=' + product, ['clients.read'], () =>
    Response.json({
      id: product,
      crm_company_id: '91',
      name: 'Компания без аккаунта',
      customer_account_ids: ['71', '72'],
      source_resolution: 'multiple',
      runtime_resolution: 'ambiguous',
      runtime_accounts: [],
      source,
      contacts: [
        {
          id: '81',
          name: 'Общий контакт',
          companies: [
            { crm_company_id: '91', company_id: product },
            { crm_company_id: '92', company_id: null },
          ],
        },
      ],
      unresolved_relations: [{ crm_company_id: '92', company_id: null }],
      sources: [],
      observation: {},
    }),
  )
  expect(await screen.findByText('Компания без аккаунта')).toBeVisible()
  expect(screen.getByText('Общий контакт')).toBeVisible()
  expect(screen.getByText('Подтверждённых доступных аккаунтов для перехода нет.')).toBeVisible()
  expect(screen.getByText('Неоднозначные аккаунты')).toBeVisible()
  expect(
    screen.getAllByRole('link').every((link) => !link.getAttribute('href')?.includes('account=')),
  ).toBe(true)
})
