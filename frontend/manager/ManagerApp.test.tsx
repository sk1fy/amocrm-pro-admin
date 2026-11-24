import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetApiSession } from '../src/api/client'
import { ManagerApp } from './ManagerApp'

const manager = {
  id: '535dfcc0-062c-42a2-88bd-e8906924da27',
  email: 'editor@example.invalid',
  name: 'Оператор',
  grants: ['clients.read', 'clients.write'],
}
const operationId = '046397dd-cb90-4d32-9eed-ed745abc4df0'
const accountId = '9007199254740993'
const time = '2026-11-17T10:00:00Z'
const row = {
  id: '8a250766-2926-4c4f-820c-9b160efeaed6',
  account_id: '8cfbe9f9-d57d-4adf-807f-fba5a94c8f03',
  amo_account_id: accountId,
  product_name: 'Тестовый продукт',
  product_code: 'test-product',
  product_line: 'TOP',
  account_domain: 'fixture-retail.amocrm.test',
  account_name: 'Тестовый аккаунт',
  generation: 1,
  kind: 'install',
  installed_at: time,
  removed_at: null,
  last_lifecycle_event: 'installed',
  lifecycle: 'current',
  authorization: 'authorized',
  activation_status: 'unavailable',
  review: { reviewed: false },
  access: {
    active: true,
    source: 'own_trial',
    valid_until: '2026-11-24T10:00:00Z',
    own_until: '2026-11-24T10:00:00Z',
    computed_at: time,
  },
  version: 1,
}
const reviewed = {
  ...row,
  review: { reviewed: true, reviewed_by: manager.id, reviewed_at: time },
  version: 2,
}

function installationPage(
  item: Omit<typeof row, 'product_line'> & { product_line?: string },
  next: string | null = null,
) {
  return Response.json({
    items: [item],
    next_cursor: next,
    snapshot_at: time,
    query_hash: 'test-query',
    summary: {
      total: 1,
      reviewed: Number(item.review.reviewed),
      unreviewed: Number(!item.review.reviewed),
    },
    queue_counts: {
      total: 1,
      reviewed: Number(item.review.reviewed),
      unreviewed: Number(!item.review.reviewed),
    },
    sources: [{ backend: 'platform', status: 'available', observed_at: time }],
  })
}

function error(status: number, detailCode?: string): Response {
  return Response.json({ error: { code: 'error', details: { code: detailCode } } }, { status })
}

function openManager(search: string) {
  window.history.replaceState(null, '', '/managers' + search)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ManagerApp />
    </QueryClientProvider>,
  )
}

function replaceFetch(handler: (url: URL, init?: RequestInit) => Response) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
    return handler(new URL(String(path), window.location.origin), init)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  resetApiSession()
  vi.unstubAllGlobals()
})

it.each([
  {
    active: true,
    category: 'PRO',
    status: 'Trial',
    classification: 'Свободный клиент',
    client: 'Свободный клиент',
  },
  {
    active: false,
    category: 'PRO',
    status: 'Не действует',
    classification: undefined,
    client: 'Не указано',
  },
  {
    active: true,
    category: undefined,
    status: 'Действует',
    classification: 'Наш клиент',
    client: 'Наш клиент',
  },
])(
  'shows widget category, access and client status independently ($status)',
  async ({ active, category, status, classification, client }) => {
    const item = {
      ...row,
      product_line: category,
      account_classification: classification,
      access: { ...row.access, active, source: category ? 'own_trial' : 'manual' },
    }
    replaceFetch((url) =>
      url.pathname.endsWith('/me') ? Response.json(manager) : installationPage(item),
    )
    openManager('?section=installations')
    expect(await screen.findByText(client)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Подробнее' }))
    const details = screen.getByRole('region', { name: 'Аккаунт amoCRM ' + accountId })
    expect(within(details).getByText('Категория').nextElementSibling).toHaveTextContent(
      category ?? 'Без категории',
    )
    expect(within(details).getByText('Статус').nextElementSibling).toHaveTextContent(status)
  },
)

it.each([
  '?section=companies&companies_q=old&clients_q=retail',
  '?section=clients&clients_tab=companies&company=fixture&clients_q=retail',
])('redirects a retired company URL to clients (%s)', async (search) => {
  const requests: string[] = []
  replaceFetch((url) => {
    requests.push(url.pathname)
    return url.pathname.endsWith('/me') ? Response.json(manager) : error(503)
  })
  openManager(search)
  expect(await screen.findByRole('heading', { name: 'Клиенты' }, { timeout: 4000 })).toBeVisible()
  expect(window.location.search).toBe('?section=clients&clients_q=retail')
  const nav = within(screen.getByRole('navigation', { name: 'Кабинет менеджеров' }))
  expect(nav.getByRole('link', { name: 'Клиенты' })).toHaveAttribute('aria-current', 'page')
  expect(nav.queryByRole('link', { name: 'Компании' })).toBeNull()
  expect(requests.some((path) => path.includes('/companies'))).toBe(false)
})

it('keeps future sections out of the workspace and uses the real review filter', async () => {
  const fetch = replaceFetch((url) =>
    url.pathname.endsWith('/me') ? Response.json(manager) : installationPage(row),
  )
  openManager('?section=payments&q=rakurs&from=2026-11-17')
  const nav = within(await screen.findByRole('navigation', { name: 'Кабинет менеджеров' }))
  expect(nav.getAllByRole('link').map((link) => link.getAttribute('aria-label'))).toEqual([
    'Установки',
    'Клиенты',
    'Виджеты',
    'Лента событий',
    'Сотрудники',
  ])
  expect(nav.getByRole('link', { name: 'Установки' })).toHaveAttribute('aria-current', 'page')
  const link = await screen.findByRole('link', { name: accountId })
  const destination = new URL(link.getAttribute('href') ?? '', window.location.href)
  expect(destination.searchParams.get('account')).toBe(row.account_id)
  expect(destination.searchParams.get('q')).toBe('rakurs')
  expect(destination.searchParams.get('from')).toBe('2026-11-17')
  expect(screen.getByRole('link', { name: 'fixture-retail' })).toHaveAttribute(
    'href',
    link.getAttribute('href'),
  )
  expect(screen.getByText('TOP', { exact: true })).toBeVisible()
  expect(screen.getByRole('columnheader', { name: 'Сделка в rakurscrm' })).toBeVisible()
  expect(screen.getByRole('button', { name: /^Непроверенные/ })).toHaveTextContent('1')
  expect(screen.getByRole('button', { name: /^Проверенные/ })).toHaveTextContent('0')
  fireEvent.click(screen.getByRole('button', { name: /^Проверенные/ }))
  expect(window.location.search).toContain('review=reviewed')
  expect(window.location.search).toContain('q=rakurs')
  expect(window.location.search).toContain('from=2026-11-17')
  expect(screen.getByRole('button', { name: /^Проверенные/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await waitFor(() =>
    expect(fetch.mock.calls.some(([path]) => String(path).includes('review=reviewed'))).toBe(true),
  )
})

describe('manager installation queue', () => {
  it('shows the verified activation contact and allows a versioned deal retry', async () => {
    const contact = {
      amo_user_id: '42',
      name: 'Сотрудник amoCRM',
      role: 'Менеджер',
      phone: '+79001234567',
      email: 'employee@example.invalid',
    }
    const target = 'https://fixture-company.amocrm.ru/leads/detail/123'
    let retrySent = false
    replaceFetch((url, init) => {
      if (url.pathname.endsWith('/me')) return Response.json(manager)
      if (url.pathname.endsWith('/crm-deal/retry')) {
        const headers = new Headers(init?.headers)
        expect(headers.get('If-Match')).toBe('"2"')
        expect(headers.get('Idempotency-Key')).toMatch(/^[a-f0-9-]{36}$/)
        retrySent = true
        return Response.json({ id: operationId, state: 'accepted' }, { status: 202 })
      }
      const deal = retrySent
        ? { state: 'succeeded', id: '123', url: target, retry_version: 3, can_retry: false }
        : { state: 'reconciling', retry_version: 2, can_retry: true }
      const item = { ...row, contact, deal }
      return installationPage(item)
    })
    openManager('?section=installations')
    expect(await screen.findByRole('link', { name: contact.phone })).toHaveAttribute(
      'href',
      'tel:' + contact.phone,
    )
    expect(screen.getByText('Активировал: Сотрудник amoCRM · Менеджер')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Проверить сделку' }))
    expect(await screen.findByRole('link', { name: /^№123/ })).toHaveAttribute('href', target)
  })

  it('retries an uncertain review with its original key, version and body and refreshes off the old snapshot', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    const commands: { key: string | null; version: string | null; body: RequestInit['body'] }[] = []
    const receiptIds: string[] = []
    const queries: URLSearchParams[] = []
    let settled = false
    replaceFetch((url, init) => {
      if (url.pathname.endsWith('/me')) return Response.json(manager)
      if (url.pathname.endsWith('/review')) {
        const headers = new Headers(init?.headers)
        expect(headers.get('X-Requested-With')).toBe('admin-ui')
        commands.push({
          key: headers.get('Idempotency-Key'),
          version: headers.get('If-Match'),
          body: init?.body,
        })
        return Response.json(
          { id: operationId, state: 'unknown_outcome' },
          { status: 202, headers: { 'Retry-After': '1' } },
        )
      }
      if (url.pathname.includes('/operations/')) {
        receiptIds.push(url.pathname.split('/').at(-1) ?? '')
        if (receiptIds.length === 1) {
          return new Response(null, { status: 503, headers: { 'Retry-After': '1' } })
        }
        settled = true
        return Response.json({ id: operationId, state: 'completed' })
      }
      queries.push(url.searchParams)
      return installationPage(settled ? reviewed : row, 'opaque-next')
    })
    openManager('?section=installations&q=' + accountId + '&limit=25&cursor=opaque%2B%2F%3D&tab=7')
    await screen.findByRole('heading', { name: 'Установки' })
    await waitFor(() => expect(screen.queryByText('Загружаем установки…')).not.toBeInTheDocument())
    expect(screen.getByRole('link', { name: accountId })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Проверен' }))

    const retry = await screen.findByRole(
      'button',
      { name: 'Повторить запрос отметки' },
      { timeout: 3_000 },
    )
    expect(screen.getByRole('button', { name: 'Проверен' })).toBeDisabled()
    expect(queries[0]?.get('cursor')).toBe('opaque+/=')
    expect(queries[0]?.has('tab')).toBe(false)
    expect(retry).toBeDisabled()
    fireEvent.click(retry)
    expect(commands).toHaveLength(1)
    await waitFor(() => expect(retry).toBeEnabled(), { timeout: 3_000 })
    fireEvent.click(retry)

    expect(await screen.findByRole('button', { name: 'Вернуть' }, { timeout: 3_000 })).toBeEnabled()
    expect(commands).toHaveLength(2)
    expect(commands[0]).toMatchObject({
      key: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      version: '"1"',
      body: '{"reviewed":true}',
    })
    expect(commands[1]).toEqual(commands[0])
    expect(receiptIds).toEqual([operationId, operationId])
    expect(queries.at(-1)?.has('cursor')).toBe(false)
    expect(queries.at(-1)?.get('q')).toBe(accountId)
    expect(window.location.search).toContain('tab=7')
    expect(window.location.search).not.toContain('cursor=')
  }, 10_000)

  it('leaves a long server delay in the uncertain state without an early poll or retry', async () => {
    const keys: (string | null)[] = []
    const receipts: string[] = []
    replaceFetch((url, init) => {
      if (url.pathname.endsWith('/me')) return Response.json(manager)
      if (url.pathname.endsWith('/review')) {
        keys.push(new Headers(init?.headers).get('Idempotency-Key'))
        return keys.length === 1
          ? Response.json(
              { id: operationId, state: 'unknown_outcome' },
              { status: 202, headers: { 'Retry-After': '20' } },
            )
          : Response.json(reviewed)
      }
      if (url.pathname.includes('/operations/')) {
        receipts.push(url.pathname)
        return Response.json({ id: operationId, state: 'completed' })
      }
      return installationPage(row)
    })
    openManager('')
    const review = await screen.findByRole('button', { name: 'Проверен' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    try {
      await act(async () => {
        fireEvent.click(review)
      })
      const retry = screen.getByRole('button', { name: 'Повторить запрос отметки' })
      expect(retry).toBeDisabled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(19_999)
      })
      fireEvent.click(retry)
      expect(retry).toBeDisabled()
      expect(keys).toHaveLength(1)
      expect(receipts).toHaveLength(0)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(retry).toBeEnabled()
      await act(async () => {
        fireEvent.click(retry)
      })
      expect(keys).toHaveLength(2)
      expect(keys[1]).toBe(keys[0])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the installation snapshot on focus and reconnect while rechecking the manager', async () => {
    let profiles = 0
    let lists = 0
    replaceFetch((url) => {
      if (url.pathname.endsWith('/me')) {
        profiles += 1
        return Response.json(manager)
      }
      lists += 1
      return installationPage(row)
    })
    openManager('')
    await screen.findByRole('link', { name: accountId })
    try {
      act(() => {
        focusManager.setFocused(false)
        focusManager.setFocused(true)
      })
      await waitFor(() => expect(profiles).toBe(2))
      act(() => {
        onlineManager.setOnline(false)
        onlineManager.setOnline(true)
      })
      await waitFor(() => expect(profiles).toBe(3))
      expect(lists).toBe(1)
    } finally {
      focusManager.setFocused(undefined)
      onlineManager.setOnline(true)
    }
  })

  it('refreshes after a version conflict and uses the new version only for a new decision', async () => {
    const headers: Headers[] = []
    replaceFetch((url, init) => {
      if (url.pathname.endsWith('/me')) return Response.json(manager)
      if (url.pathname.endsWith('/review')) {
        headers.push(new Headers(init?.headers))
        if (headers.length === 1) return error(409, 'version_conflict')
        return Response.json(reviewed)
      }
      return installationPage(headers.length ? { ...row, version: 2 } : row)
    })
    openManager('')
    fireEvent.click(await screen.findByRole('button', { name: 'Проверен' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Отметка уже изменилась.')
    expect(headers).toHaveLength(1)
    fireEvent.click(await screen.findByRole('button', { name: 'Проверен' }))
    expect(await screen.findByText('Отметка проверки сохранена.')).toBeVisible()
    expect(headers[0]?.get('If-Match')).toBe('"1"')
    expect(headers[1]?.get('If-Match')).toBe('"2"')
    expect(headers[1]?.get('Idempotency-Key')).not.toBe(headers[0]?.get('Idempotency-Key'))
  })

  it('removes fetched rows and the account card when a write returns forbidden', async () => {
    let revoked = false
    replaceFetch((url) => {
      if (url.pathname.endsWith('/me')) {
        return Response.json(revoked ? { ...manager, grants: ['stats.read'] } : manager)
      }
      if (url.pathname.endsWith('/review')) {
        revoked = true
        return error(403)
      }
      return installationPage(row)
    })
    openManager('?section=installations')
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее' }))
    expect(screen.getByRole('heading', { name: 'Аккаунт amoCRM ' + accountId })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Проверен' }))

    expect(await screen.findByText('Нет доступа к установкам.')).toBeVisible()
    expect(screen.queryByRole('link', { name: accountId })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Аккаунт amoCRM ' + accountId }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Повторить запрос отметки' }),
    ).not.toBeInTheDocument()
  })

  it('returns to sign-in and keeps the direct URL when the queue session expires', async () => {
    replaceFetch((url) => {
      if (url.pathname.endsWith('/me')) return Response.json(manager)
      if (url.searchParams.has('q')) return error(401)
      return installationPage(row)
    })
    openManager('?section=installations')
    expect(await screen.findByRole('link', { name: accountId })).toBeVisible()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по установкам' }), {
      target: { value: accountId },
    })

    fireEvent.submit(screen.getByRole('form', { name: 'Фильтры установок' }))
    await screen.findByText('Email', { selector: 'label' }, { timeout: 3_000 })
    expect(screen.getByRole('button', { name: 'Войти' })).toBeVisible()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('q')).toBe(accountId)
  })
})
