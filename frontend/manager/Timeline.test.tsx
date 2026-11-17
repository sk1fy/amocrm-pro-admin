import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  vi.mocked(listEvents).mockResolvedValue({ ...oldPage, query_hash: 'fresh' })
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
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(''))
  expect(client.getQueryData(['managers', 'timeline', 'subject', context, ''])).toEqual({
    ...oldPage,
    query_hash: 'fresh',
  })
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
