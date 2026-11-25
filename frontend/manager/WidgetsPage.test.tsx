import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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
  technicalControls = false,
) {
  window.history.replaceState(null, '', '/managers?' + search)
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const path = new URL(String(url), window.location.origin)
      return path.pathname.endsWith('/me')
        ? Response.json({ ...profile(grants), widget_technical_controls: technicalControls })
        : handler(path, init)
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ManagerApp />
    </QueryClientProvider>,
  )
  return client
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
})
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
  open(
    ['stats.read'],
    'section=widgets&product=' + id + '&metrics_from=2026-01-01',
    (url) => {
      paths.push(url.pathname + url.search)
      expect(url.pathname).toBe('/api/v1/managers/products/' + id + '/metrics')
      expect(url.searchParams.get('from')).toBe('2026-01-01')
      return Response.json({
        confirmed_installations: 3,
        active_accesses: 3,
        activations: 0,
        snapshot_at: time,
      })
    },
    true,
  )
  const toggle = await screen.findByRole('button', { name: 'Технический режим' })
  expect(paths).toHaveLength(0)
  fireEvent.click(toggle)
  expect(
    await screen.findByText(
      'Активации считаются по записям формы для установок выбранного периода.',
    ),
  ).toBeVisible()
  expect(screen.queryByRole('textbox', { name: 'Название' })).not.toBeInTheDocument()
  expect(paths).toHaveLength(1)
})

it('recovers a catalog-only create DTO on HTTP by exact resubmission after a completed receipt', async () => {
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
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
  expect(await screen.findByRole('dialog', { name: 'Новый виджет' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Технический режим' })).toBeNull()
  fireEvent.change(await screen.findByLabelText('Код'), { target: { value: 'test-widget' } })
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Виджет' } })
  fireEvent.click(screen.getByRole('button', { name: 'Создать виджет' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Проверить результат' }))
  await screen.findByRole('button', { name: 'Сохранить виджет' }, { timeout: 4000 })
  expect(commands).toHaveLength(2)
  expect(commands[0].key).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  expect(commands[1]).toEqual(commands[0])
  expect(new URLSearchParams(window.location.search).get('product')).toBe(id)
})

it('retains an editor draft on conflict and rebases only through an explicit action', async () => {
  let current = product
  const versions: (string | null)[] = []
  const keys: (string | null)[] = []
  open(['catalog.read', 'catalog.manage'], 'section=widgets&product=' + id, (_url, init) => {
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
  const name = await screen.findByLabelText('Название')
  expect(screen.queryByText('Технические данные')).toBeNull()
  expect(screen.queryByLabelText('Добавить UUID интеграции Core')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Технический режим' })).toBeNull()
  fireEvent.change(name, { target: { value: 'Мой черновик' } })
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

it('uses refreshed same-version mappings for the next edit and preserves a pending command', async () => {
  const originalRef = 'eaf2bbd1-277a-45aa-949d-a4ec53820e52'
  const refreshedRef = '44869492-864f-429f-b7e8-857ced38b690'
  const laterRef = 'c28e6c72-773d-4ce8-b51b-982c920ce80c'
  let current = { ...product, integration_refs: [originalRef] }
  const commands: { body: RequestInit['body']; key: string | null; version: string | null }[] = []
  const client = open(
    ['catalog.read', 'catalog.manage'],
    'section=widgets&product=' + id,
    (_url, init) => {
      if (init?.method === 'PATCH') {
        commands.push({
          body: init.body,
          key: new Headers(init.headers).get('Idempotency-Key'),
          version: new Headers(init.headers).get('If-Match'),
        })
        if (commands.length > 1) {
          return Response.json({ id: receipt, state: 'unknown_outcome' }, { status: 202 })
        }
        current = { ...current, display_name: 'Сохранённое название', version: 2 }
      }
      return Response.json(current, { headers: { ETag: '"' + current.version + '"' } })
    },
    true,
  )
  fireEvent.change(await screen.findByLabelText('Название'), {
    target: { value: 'Сохранённое название' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить виджет' }))
  await screen.findByText('Сохранено.')

  current = { ...current, integration_refs: [originalRef, refreshedRef] }
  await act(() => client.invalidateQueries({ queryKey: ['managers', 'products'] }))
  expect(screen.queryByText('Технические данные')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Технический режим' }))
  fireEvent.click(screen.getByText('Технические данные'))
  await waitFor(() =>
    expect(screen.getByText([originalRef, refreshedRef].join(', '))).toBeVisible(),
  )
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Следующее название' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить виджет' }))
  await screen.findByText('Результат команды пока неизвестен.')
  expect(commands).toHaveLength(2)
  expect(commands[1].version).toBe('"2"')
  expect(JSON.parse(String(commands[1].body))).toMatchObject({
    display_name: 'Следующее название',
    integration_refs: [originalRef, refreshedRef],
  })

  current = { ...current, integration_refs: [originalRef, refreshedRef, laterRef], version: 3 }
  await act(() => client.invalidateQueries({ queryKey: ['managers', 'products'] }))
  await waitFor(() =>
    expect(
      within(screen.getByRole('form', { name: 'Карточка виджета' })).getByText(
        [originalRef, refreshedRef, laterRef].join(', '),
      ),
    ).toBeVisible(),
  )
  expect(screen.getByLabelText('Название')).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить ту же команду' }))
  await waitFor(() => expect(commands).toHaveLength(3))
  expect(commands[2]).toEqual(commands[1])
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

it('renders monthly widget installations and keeps the overview while filtering', async () => {
  const monthly = Array.from({ length: 12 }, (_, index) => ({
    month: '2026-' + String(index + 1).padStart(2, '0'),
    count: index === 10 ? 5 : 0,
  }))
  const pilot = {
    ...product,
    display_name: 'Контроль активности',
    line: 'PRO',
    availability: 'pilot',
    trial_policy: { kind: 'once', duration_days: 7 },
    tariff_version: 2,
    links: [{ label: 'Документация', url: 'https://fixture.example.invalid/docs' }],
  }
  let filtered = false
  open(['catalog.read', 'clients.read', 'stats.read'], 'section=widgets', (url) => {
    expect(url.searchParams.get('overview')).toBe('true')
    filtered = url.searchParams.get('attention') === 'true'
    return Response.json({
      items: filtered ? [] : [pilot],
      snapshot_at: time,
      query_hash: 'a'.repeat(64),
      next_cursor: null,
      overview: {
        summary: {
          total: 1,
          by_line: { FREE: 0, TOP: 0, PRO: 1 },
          installations: 5,
          current: 3,
          recent: 5,
          activation_eligible: 0,
          activated: 0,
          attention: 0,
          connection_count: 0,
        },
        statistics: filtered
          ? {}
          : {
              [id]: {
                months: monthly,
                installations: 5,
                current: 3,
                retained: 3,
                recent: 5,
                activation_eligible: 0,
                activated: 0,
                connection_count: 0,
                missing_install_link: false,
                missing_instruction: false,
              },
            },
        connections: [],
      },
    })
  })

  const table = await screen.findByRole('table')
  expect(within(table).getByRole('link', { name: 'Контроль активности' })).toBeVisible()
  expect(within(table).getByText('Пилот')).toBeVisible()
  expect(within(table).getByText('Нет ссылки на установку')).toBeVisible()
  expect(within(table).getByRole('link', { name: 'Инструкция' })).toHaveAttribute(
    'href',
    'https://fixture.example.invalid/docs',
  )
  expect(within(table).queryByRole('columnheader', { name: 'Доступность' })).toBeNull()
  expect(within(table).getByRole('columnheader', { name: 'Тест · тариф' })).toBeVisible()
  expect(within(table).getByText('7 дн.')).toBeVisible()
  expect(within(table).getByText('Версия 2')).toBeVisible()
  expect(within(table).getByRole('img', { name: /ноябрь 2026 г\. — 5/ }).children).toHaveLength(12)
  expect(within(table).getByText('+5 за 30 дн.')).toBeVisible()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Только требующие внимания' }))
  await screen.findByText('Виджеты не найдены')
  expect(filtered).toBe(true)
  expect(screen.getByRole('group', { name: 'Сводка каталога' })).toBeVisible()
})
