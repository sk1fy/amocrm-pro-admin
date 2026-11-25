import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { isAccountId } from './accountsApi'
import { parseEvent, listEvents } from './eventsApi'
import { Timeline, eventLinks, eventQuery } from './Timeline'
vi.mock('./eventsApi', async (original) => ({
  ...(await original<typeof import('./eventsApi')>()),
  listEvents: vi.fn(),
}))
const account = '661cf98b-8df1-42cc-beb4-443745c9a1c5'
if (!isAccountId(account)) throw new Error('invalid fixture')
const event = parseEvent({
  id: account,
  kind: 'installed',
  occurred_at: '2026-11-17T00:00:00Z',
  recorded_at: '2026-11-17T00:00:00Z',
  summary: 'Fixture',
  account_id: account,
  related_refs: [{ kind: 'installation', id: account }],
})
afterEach(() => vi.resetAllMocks())
it('separates feed/history namespaces and forwards date-only filters', () => {
  const search =
    'feed_kind=installed&feed_kind=activated&feed_from=2026-11-17&feed_account_id=' +
    account +
    '&history_kind=access_renewed'
  expect(eventQuery(search, { kind: 'feed' }).getAll('kind')).toEqual(['installed', 'activated'])
  expect(eventQuery(search, { kind: 'feed' }).get('from')).toBe('2026-11-17')
  expect(eventQuery(search, { kind: 'history', account }).toString()).toBe('kind=access_renewed')
})
it('requires refs and grants for links and never infers an installation parent from account_id', () => {
  expect(eventLinks(event, ['clients.read'], '')).toEqual([])
  const withParent = {
    ...event,
    related_refs: [...event.related_refs, { kind: 'account' as const, id: account }],
  }
  expect(eventLinks(withParent, ['feed.read'], '')).toEqual([])
  expect(eventLinks(withParent, ['clients.read'], '')[0]?.search).toContain('episode=' + account)
})
it('refreshes cached first-page data when explicitly refreshing from page two', async () => {
  const client = new QueryClient()
  const context = { kind: 'feed' as const }
  const oldPage = {
    items: [event],
    next_cursor: 'next',
    snapshot_at: event.occurred_at,
    query_hash: 'old',
  }
  client.setQueryData(['managers', 'timeline', 'subject', context, ''], oldPage)
  client.setQueryData(['managers', 'timeline', 'subject', context, 'cursor=next'], oldPage)
  let finishRefresh: (value: typeof oldPage) => void = () => undefined
  const refresh = new Promise<typeof oldPage>((resolve) => {
    finishRefresh = resolve
  })
  vi.mocked(listEvents).mockImplementation(async (_context, query) =>
    query === '' ? refresh : oldPage,
  )
  const navigate = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <Timeline
        context={context}
        search="feed_cursor=next"
        navigate={navigate}
        scope="subject"
        grants={['feed.read']}
        onExpired={vi.fn()}
        onForbidden={vi.fn()}
      />
    </QueryClientProvider>,
  )
  await screen.findByText('Fixture')
  fireEvent.click(screen.getByRole('button', { name: 'Обновить события' }))
  await waitFor(() => expect(listEvents).toHaveBeenCalledWith(context, '', expect.any(AbortSignal)))
  expect(navigate).toHaveBeenCalledWith('')
  fireEvent.change(screen.getByLabelText('С (Москва)'), { target: { value: '2026-11-17' } })
  fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
  finishRefresh({ ...oldPage, query_hash: 'fresh' })
  await waitFor(() =>
    expect(client.getQueryData(['managers', 'timeline', 'subject', context, ''])).toEqual({
      ...oldPage,
      query_hash: 'fresh',
    }),
  )
  expect(navigate.mock.calls).toEqual([[''], ['feed_from=2026-11-17']])
})
it('does not request feed with only clients.read', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Timeline
        context={{ kind: 'feed' }}
        search=""
        navigate={vi.fn()}
        scope="reader"
        grants={['clients.read']}
        onExpired={vi.fn()}
        onForbidden={vi.fn()}
      />
    </QueryClientProvider>,
  )
  expect(screen.getByRole('alert')).toHaveTextContent('Нет доступа к ленте')
  expect(listEvents).not.toHaveBeenCalled()
})

it('shows only permitted client labels and keeps exact times and links in the event details', async () => {
  const client = new QueryClient()
  const labeledEvent = parseEvent({
    ...event,
    account_subdomain: 'fixture-1',
    product_display_name: 'Тестовый виджет',
    related_refs: [{ kind: 'account', id: account }],
  })
  vi.mocked(listEvents).mockResolvedValue({
    items: [labeledEvent],
    next_cursor: null,
    snapshot_at: event.occurred_at,
    query_hash: 'snapshot',
  })
  function feed(grants: string[]) {
    return (
      <QueryClientProvider client={client}>
        <Timeline
          context={{ kind: 'feed' }}
          search=""
          navigate={vi.fn()}
          scope="subject"
          grants={grants}
          onExpired={vi.fn()}
          onForbidden={vi.fn()}
        />
      </QueryClientProvider>
    )
  }
  const view = render(feed(['feed.read', 'clients.read']))
  expect(await screen.findByText('fixture-1')).toBeVisible()
  expect(screen.getByText('Fixture · Тестовый виджет')).toBeVisible()
  const summary = screen.getByText('Подробнее').closest('summary')
  if (!summary) throw new Error('missing details summary')
  expect(summary.parentElement).not.toHaveAttribute('open')
  fireEvent.click(summary)
  expect(screen.getByText('Событие (Москва)')).toBeVisible()
  expect(screen.getByText('Записано (Москва)')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Аккаунт' })).toBeVisible()

  view.rerender(feed(['feed.read']))
  expect(within(screen.getByRole('listitem')).getByText('Установка')).toBeVisible()
  expect(screen.queryByText('fixture-1')).not.toBeInTheDocument()
  expect(screen.queryByText('Fixture · Тестовый виджет')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Аккаунт' })).not.toBeInTheDocument()
})

it('applies kinds and period while retaining linked filters and clearing the cursor', async () => {
  vi.mocked(listEvents).mockResolvedValue({
    items: [event],
    next_cursor: null,
    snapshot_at: event.occurred_at,
    query_hash: 'snapshot',
  })
  const navigate = vi.fn<(search: string) => void>()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Timeline
        context={{ kind: 'feed' }}
        search={
          'section=feed&feed_kind=installed&feed_cursor=next&feed_limit=1&feed_product_id=' +
          account
        }
        navigate={navigate}
        scope="subject"
        grants={['feed.read']}
        onExpired={vi.fn()}
        onForbidden={vi.fn()}
      />
    </QueryClientProvider>,
  )
  await screen.findByText('Fixture')
  expect(
    within(screen.getByRole('list', { name: 'Активные фильтры' })).getByText(/Установка/),
  ).toBeVisible()
  fireEvent.click(screen.getByText('Виды событий', { selector: 'summary' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Активация' }))
  expect(screen.queryByText('Ещё фильтры')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('ID продукта')).not.toBeInTheDocument()
  expect(screen.getByText('ID продукта: ' + account)).toBeVisible()
  fireEvent.change(screen.getByLabelText('С (Москва)'), { target: { value: '2026-11-17' } })
  fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
  const applied = new URLSearchParams(navigate.mock.calls[0]?.[0])
  expect(applied.getAll('feed_kind')).toEqual(['installed', 'activated'])
  expect(applied.get('feed_product_id')).toBe(account)
  expect(applied.get('feed_from')).toBe('2026-11-17')
  expect(applied.get('feed_limit')).toBe('1')
  expect(applied.has('feed_cursor')).toBe(false)
})

it('shows the widget and applies history groups across the event stream', async () => {
  const labeledEvent = parseEvent({ ...event, product_display_name: 'Тестовый виджет' })
  vi.mocked(listEvents).mockResolvedValue({
    items: [labeledEvent],
    next_cursor: null,
    snapshot_at: event.occurred_at,
    query_hash: 'snapshot',
  })
  const navigate = vi.fn<(search: string) => void>()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Timeline
        context={{ kind: 'history', account }}
        search="section=installations&tab=history&history_from=2026-11-17&history_cursor=old"
        navigate={navigate}
        scope="subject"
        grants={['clients.read']}
        onExpired={vi.fn()}
        onForbidden={vi.fn()}
      />
    </QueryClientProvider>,
  )
  expect(await screen.findByRole('cell', { name: 'Тестовый виджет' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Всё' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Правки' }))
  const search = new URLSearchParams(navigate.mock.calls[0]?.[0])
  expect(search.get('section')).toBe('installations')
  expect(search.get('history_from')).toBe('2026-11-17')
  expect(search.has('history_cursor')).toBe(false)
  expect(search.getAll('history_kind')).toEqual([
    'installation_reviewed',
    'installation_unreviewed',
    'subscription_granted',
    'subscription_renewed',
    'subscription_seats',
    'subscription_revoked',
    'account_profile_updated',
    'portrait_updated',
  ])
})
