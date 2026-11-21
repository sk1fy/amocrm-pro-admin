import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { resetApiSession } from '../src/api/client'
import { AccountPortrait } from './AccountPortrait'
import { AccountCommands } from './accountCommands'
import { isAccountId } from './accountsApi'

const account = '661cf98b-8df1-42cc-beb4-443745c9a1c5'
const niche = '93b2fbb7-13ce-47cc-8608-c3bf855c7201'
const topic = '7f956a05-6f59-4716-ae93-461b18fa34f2'
const portrait = {
  account_id: account,
  version: 1,
  template_version: 1,
  company: { work_types: ['гибрид'], rating: 0 },
  maturity_signals: [],
  topics: [{ id: topic, note: 'Согласовали следующий шаг' }],
  audit_dates: [
    {
      id: 'dc35c307-c75a-4177-a388-3d3dc440653b',
      date: '2026-11-19',
      note: 'Заметка ручного аудита',
    },
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
  resetApiSession()
  vi.unstubAllGlobals()
})

it('searches the full niche catalog and keeps existing work types when selecting a preset', async () => {
  if (!isAccountId(account)) throw new Error('invalid fixture')
  const dispatch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin)
    if (url.pathname.endsWith('/portrait')) {
      return init?.method === 'PATCH'
        ? Response.json({ account_id: account, version: 2 }, { headers: { ETag: '"2"' } })
        : Response.json(portrait, { headers: { ETag: '"1"' } })
    }
    if (url.pathname.endsWith('/portrait-template'))
      return Response.json(
        { version: 1, topics: [{ id: topic, title: 'Тема разговора', prompts: ['Что важно?'] }] },
        { headers: { ETag: '"1"' } },
      )
    if (url.pathname.endsWith('/portrait-niches'))
      return Response.json({
        items:
          url.searchParams.get('q') === 'Производство'
            ? [{ id: niche, name: 'Производство', version: 1 }]
            : [],
        next_cursor: null,
        snapshot_at: '2026-11-18T19:30:00Z',
        query_hash: 'fixture',
      })
    throw new Error('unexpected request ' + url + ' ' + init?.method)
  })
  vi.stubGlobal('fetch', dispatch)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AccountCommands>
        <AccountPortrait
          account={account}
          scope="subject"
          canWrite
          canConfigure={false}
          onExpired={vi.fn()}
          onForbidden={vi.fn()}
          onSaved={vi.fn()}
        />
      </AccountCommands>
    </QueryClientProvider>,
  )
  const input = await screen.findByRole('searchbox', { name: 'Поиск по нишам' })
  expect(screen.queryByText('Аудит', { exact: true })).not.toBeInTheDocument()
  expect(screen.queryByText('Заметка ручного аудита', { exact: true })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^0$/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('Заметки заполнены · 1 из 1')).toBeVisible()
  fireEvent.change(input, { target: { value: 'Производство' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.click(await screen.findByRole('button', { name: 'Производство' }))
  await waitFor(() => expect(input).toHaveValue('Производство'))
  const group = screen.getByRole('group', { name: 'Менеджеры работают' })
  fireEvent.click(within(group).getByRole('button', { name: 'в офисе' }))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await screen.findByText('Сохранено.')
  const patch = dispatch.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1]
  expect(new Headers(patch?.headers).get('If-Match')).toBe('"1"')
  expect(JSON.parse(String(patch?.body))).toEqual({
    company: { niche_id: niche, work_types: ['гибрид', 'в офисе'] },
    maturity_signals: [],
    topics: [],
  })
})
