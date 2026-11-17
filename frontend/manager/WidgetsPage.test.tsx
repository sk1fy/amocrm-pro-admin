import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { resetApiSession } from '../src/api/client'
import { ManagerApp } from './ManagerApp'
import { isProductId, sendProductCommand } from './productsApi'
import { productQuery, productSearch } from './WidgetsPage'
import { listSearch } from './accountsLocation'

const id = '10f803ed-c6f3-48db-ae9f-26ab8e81f3c1'
const receipt = '88982482-3c5d-4c92-91e7-8281e6f3cd30'
const time = '2026-11-17T10:00:00Z'
const product = {
  id,
  code: 'test-widget',
  display_name: 'Виджет',
  line: 'FREE',
  availability: 'draft',
  integration_refs: [],
  tariff_version: null,
  trial_policy: { kind: 'none', duration_days: null },
  links: [],
  version: 1,
}
function profile(grants: string[]) {
  return {
    id: '688388de-383c-499d-a572-fc0b33d69cfe',
    name: 'Менеджер',
    email: 'manager@example.invalid',
    grants,
  }
}
function open(
  grants: string[],
  search: string,
  handler: (url: URL, init?: RequestInit) => Response,
) {
  window.history.replaceState(null, '', '/managers?' + search)
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const path = new URL(String(url), window.location.origin)
      return path.pathname.endsWith('/me') ? Response.json(profile(grants)) : handler(path, init)
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ManagerApp />
    </QueryClientProvider>,
  )
}
afterEach(() => {
  resetApiSession()
  vi.unstubAllGlobals()
})

it('keeps catalog filters separate and clears entity selection between sections', () => {
  const search =
    'section=clients&account=' +
    id +
    '&clients_q=client&q=installation&products_q=widget&products_cursor=opaque&metrics_from=2026-01-01'
  expect(productQuery(search).toString()).toBe('q=widget&cursor=opaque')
  const widgets = productSearch(search, { product: id })
  expect(widgets).not.toContain('account=')
  expect(widgets).toContain('clients_q=client')
  expect(listSearch(widgets, 'clients')).not.toContain('product=')
  expect(listSearch(widgets, 'clients')).toContain('products_cursor=opaque')
})

it('loads metrics for stats-only grants without a list or detail read', async () => {
  const paths: string[] = []
  open(['stats.read'], 'section=widgets&product=' + id + '&metrics_from=2026-01-01', (url) => {
    paths.push(url.pathname + url.search)
    expect(url.pathname).toBe('/api/v1/managers/products/' + id + '/metrics')
    expect(url.searchParams.get('from')).toBe('2026-01-01')
    return Response.json({
      confirmed_installations: 3,
      active_accesses: 3,
      activations: 0,
      snapshot_at: time,
    })
  })
  expect(
    await screen.findByText(
      'Источник активаций G03 пока не подключён. Ноль означает отсутствие записанных событий, а не подтверждённое отсутствие активаций.',
    ),
  ).toBeVisible()
  expect(screen.queryByRole('textbox', { name: 'Название' })).not.toBeInTheDocument()
  expect(paths).toHaveLength(1)
})

it('recovers a catalog-only create DTO by exact resubmission after a completed receipt', async () => {
  const commands: { body: RequestInit['body']; key: string | null }[] = []
  let completed = false
  open(['catalog.manage'], 'section=widgets&product_new=1', (url, init) => {
    if (url.pathname.includes('/operations/')) {
      completed = true
      return Response.json({ id: receipt, state: 'completed' })
    }
    expect(init?.method).toBe('POST')
    expect(url.pathname).toBe('/api/v1/managers/products')
    commands.push({ body: init?.body, key: new Headers(init?.headers).get('Idempotency-Key') })
    return completed
      ? Response.json(product, { status: 201, headers: { ETag: '"1"' } })
      : Response.json({ id: receipt, state: 'unknown_outcome' }, { status: 202 })
  })
  fireEvent.change(await screen.findByLabelText('Код'), { target: { value: 'test-widget' } })
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Виджет' } })
  fireEvent.click(screen.getByRole('button', { name: 'Создать виджет' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Проверить результат' }))
  await screen.findByRole('button', { name: 'Сохранить виджет' }, { timeout: 4000 })
  expect(commands).toHaveLength(2)
  expect(commands[1]).toEqual(commands[0])
  expect(new URLSearchParams(window.location.search).get('product')).toBe(id)
})

it('retains an editor draft on conflict and rebases only through an explicit action', async () => {
  let current = product
  const versions: (string | null)[] = []
  const keys: (string | null)[] = []
  open(['clients.read', 'catalog.manage'], 'section=widgets&product=' + id, (_url, init) => {
    if (init?.method === 'PATCH') {
      versions.push(new Headers(init.headers).get('If-Match'))
      keys.push(new Headers(init.headers).get('Idempotency-Key'))
      if (versions.length === 1) {
        current = { ...product, display_name: 'Сохранено коллегой', version: 2 }
        return Response.json(
          {
            error: { code: 'conflict', details: { code: 'version_conflict', current_version: 2 } },
          },
          { status: 409 },
        )
      }
      current = { ...current, display_name: 'Мой черновик', version: 3 }
    }
    return Response.json(current, { headers: { ETag: '"' + current.version + '"' } })
  })
  fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Мой черновик' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить виджет' }))
  await screen.findByText('Текущее название: Сохранено коллегой')
  expect(screen.getByLabelText('Название')).toHaveValue('Мой черновик')
  const rebase = screen.getByRole('button', { name: 'Применить черновик к текущей версии' })
  await waitFor(() => expect(rebase).toBeEnabled())
  fireEvent.click(rebase)
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить виджет' }))
  await screen.findByText('Сохранено.')
  expect(versions).toEqual(['"1"', '"2"'])
  expect(keys[1]).not.toBe(keys[0])
})

it('rejects a create response with an unexpected code and allows an adopted non-command UUID', async () => {
  const key = 'aaf7c9ef-2a94-494c-a3e6-6d9952f1b2a7'
  const command = {
    kind: 'product-create',
    code: 'test-widget',
    key,
    body: '{}',
  } satisfies Parameters<typeof sendProductCommand>[0]
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ ...product, code: 'wrong' }, { status: 201, headers: { ETag: '"1"' } }),
      ),
  )
  await expect(sendProductCommand(command, new AbortController().signal)).rejects.toThrow()
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(product, { status: 201, headers: { ETag: '"1"' } })),
  )
  expect(await sendProductCommand(command, new AbortController().signal)).toMatchObject({
    kind: 'completed',
    product: { id },
  })
  expect(isProductId('00000000-0000-0000-0000-000000000000')).toBe(false)
})
