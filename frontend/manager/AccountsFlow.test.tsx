import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { resetApiSession } from '../src/api/client'
import {
  accountSearch,
  getAccountLocation,
  getAccountSearch,
  listSearch,
  ratingField,
  updateAccountSearch,
} from './accountsLocation'
import { ManagerApp } from './ManagerApp'

const account = '661cf98b-8df1-42cc-beb4-443745c9a1c5'
const path = '/api/v1/managers/accounts/' + account
const manager = {
  id: 'employee',
  email: 'operator@example.invalid',
  name: 'Оператор',
  grants: ['clients.read', 'clients.write'],
}
const unknown = { state: 'unknown', source: 'amoCRM' }

function managerCard(
  update: (init?: RequestInit) => Response,
  current: () => { version: number; note: string | null },
  renew = false,
) {
  window.history.replaceState(null, '', '/managers?' + accountSearch('section=clients', account))
  const dispatch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/v1/managers/me')
      return Response.json(
        renew ? { ...manager, grants: [...manager.grants, 'clients.renew'] } : manager,
      )
    if (url === path + '/subscription' || url === path + '/profile') return update(init)
    if (url === path + '/crm-users')
      return Response.json({
        state: 'fresh',
        source: 'amoCRM',
        observed_at: '2026-11-18T19:30:00Z',
        value: [
          { id: '10001', name: 'Ирина', is_active: true, is_admin: true },
          { id: '10002', name: 'Алексей', is_active: false, is_admin: false },
        ],
      })
    if (url === path + '/widgets?limit=100' || url === path + '/history')
      return Response.json({
        items: [],
        next_cursor: null,
        snapshot_at: '2026-11-18T19:30:00Z',
        query_hash: 'fixture',
      })
    if (url !== path) throw new Error('unexpected request ' + url)
    const detail = current()
    const { version } = detail
    return Response.json(
      {
        account_id: account,
        amo_account_id: '9007199254740993',
        current_domain: null,
        domain_aliases: null,
        display_name: 'Клиент',
        classification: null,
        active_products_count: 0,
        license: { state: 'unsupported', source: 'amoCRM' },
        active_users: unknown,
        ...detail,
        region: null,
        time_zone: null,
        amostart: unknown,
        capabilities: [
          { action: 'account.profile', allowed: true },
          { action: 'account.subscription', allowed: renew },
        ],
      },
      { headers: { ETag: '"' + version + '"' } },
    )
  })
  vi.stubGlobal('fetch', dispatch)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ManagerApp />
    </QueryClientProvider>,
  )
}

async function editNote(value: string) {
  const add = await screen.findByRole('region', { name: 'Примечание' })
  const edit = within(add).queryByRole('button', { name: /^(Добавить|Изменить)$/ })
  if (edit) fireEvent.click(edit)
  fireEvent.change(await screen.findByRole('textbox', { name: 'Заметка' }), {
    target: { value },
  })
}

afterEach(() => {
  resetApiSession()
  vi.unstubAllGlobals()
})

it('keeps list and card navigation state separate and forwards the same portrait tree with an opaque cursor', () => {
  const filter = JSON.stringify({ condition: { field_id: ratingField, op: 'gte', value: 3 } })
  const query = updateAccountSearch('q=installation&tab=7', {
    q: 'pilot',
    classification: ['Свободный клиент', 'Запрет работы'],
    cursor: 'opaque+/=',
    portrait: filter,
  })
  const request = getAccountSearch(query)
  expect(request.query.get('q')).toBe('pilot')
  expect(request.query.getAll('classification')).toEqual(['Свободный клиент', 'Запрет работы'])
  expect(request.filter).toBe(filter)
  expect(request.query.get('cursor')).toBe('opaque+/=')
  expect(request.query.has('tab')).toBe(false)
  expect(listSearch(accountSearch(query, account, 'portrait'))).toBe(query)
  const legacyAudit = 'section=clients&clients_q=pilot&account=' + account + '&tab=audit'
  expect(getAccountLocation(legacyAudit)).toMatchObject({ id: account, tab: 'widgets' })
  expect(listSearch(legacyAudit)).toBe('section=clients&clients_q=pilot')
})

it('applies the group and classification from a card row, then clears only the classification from the card heading', async () => {
  const snapshot = '2026-11-18T19:30:00Z'
  const calls: URLSearchParams[] = []
  window.history.replaceState(null, '', '/managers?section=clients&clients_q=fixture')
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input), window.location.origin)
    if (url.pathname === '/api/v1/managers/me') return Response.json(manager)
    if (url.pathname !== '/api/v1/managers/accounts') throw new Error('unexpected request')
    calls.push(url.searchParams)
    return Response.json({
      items: [],
      next_cursor: null,
      snapshot_at: snapshot,
      query_hash: 'fixture',
      summary: {
        total: 0,
        overview: {
          all: { total: 2, by_classification: { 'Клиент партнёра': 1 } },
          receiving: { total: 1, by_classification: { 'Клиент партнёра': 1 } },
          no_data: { total: 1, by_classification: {} },
          blocked: { total: 0, by_classification: {} },
        },
      },
      sources: [{ backend: 'platform', status: 'available', observed_at: snapshot }],
    })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ManagerApp />
    </QueryClientProvider>,
  )

  await screen.findByText('Найдено 0 из 2', {}, { timeout: 5000 })
  const row = screen.getByRole('button', { name: 'получаем данные · Клиенты партнёров · 1' })
  fireEvent.click(row)
  await waitFor(() => {
    expect(calls.at(-1)?.get('data_group')).toBe('receiving')
    expect(calls.at(-1)?.get('classification')).toBe('Клиент партнёра')
  })
  expect(row).toHaveAttribute('aria-pressed', 'true')

  const heading = screen.getByRole('button', { name: '1 получаем данные' })
  fireEvent.click(heading)
  await waitFor(() => expect(calls.at(-1)?.has('classification')).toBe(false))
  expect(calls.at(-1)?.get('data_group')).toBe('receiving')
  expect(calls.at(-1)?.get('q')).toBe('fixture')
  expect(heading).toHaveAttribute('aria-pressed', 'true')
  expect(row).toHaveAttribute('aria-pressed', 'false')
})

it('retains a stale note draft and uses the current version only after explicit rebase', async () => {
  let current = { version: 1, note: 'Исходная заметка' }
  const calls: { key: string | null; version: string | null; body: RequestInit['body'] }[] = []
  managerCard(
    (init) => {
      const headers = new Headers(init?.headers)
      calls.push({
        key: headers.get('Idempotency-Key'),
        version: headers.get('If-Match'),
        body: init?.body,
      })
      if (calls.length === 1) {
        current = { version: 2, note: 'Коллега сохранил заметку' }
        return Response.json(
          {
            error: { code: 'conflict', details: { code: 'version_conflict', current_version: 2 } },
          },
          { status: 409 },
        )
      }
      current = { version: 3, note: 'Мой черновик' }
      return Response.json({ account_id: account, version: 3 }, { headers: { ETag: '"3"' } })
    },
    () => current,
  )
  await editNote('Мой черновик')
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Текущая версия 2')
  expect(screen.getByRole('textbox', { name: 'Заметка' })).toHaveValue('Мой черновик')
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  const rebase = screen.getByRole('button', { name: 'Применить черновик к текущей версии' })
  await waitFor(() => expect(rebase).toBeEnabled())
  fireEvent.click(rebase)
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await screen.findByText('Мой черновик')
  expect(calls).toHaveLength(2)
  expect(calls[0]?.version).toBe('"1"')
  expect(calls[1]?.version).toBe('"2"')
  expect(calls[1]?.key).not.toBe(calls[0]?.key)
  expect(calls[1]?.body).toBe(calls[0]?.body)
})

it('keeps an uncertain command across tabs and repeats the exact request', async () => {
  const calls: { key: string | null; version: string | null; body: RequestInit['body'] }[] = []
  managerCard(
    (init) => {
      const headers = new Headers(init?.headers)
      calls.push({
        key: headers.get('Idempotency-Key'),
        version: headers.get('If-Match'),
        body: init?.body,
      })
      if (calls.length === 1) throw new TypeError('response lost')
      return Response.json(
        { id: '1945171c-e361-4045-b94c-ddb23890b2be', state: 'unknown_outcome' },
        { status: 202 },
      )
    },
    () => ({ version: 1, note: null }),
  )
  await editNote('Одна команда')
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await screen.findByText('Результат команды пока неизвестен.')
  fireEvent.click(screen.getByRole('link', { name: 'История' }))
  fireEvent.click(screen.getByRole('link', { name: 'Наши виджеты' }))
  expect(screen.getByRole('textbox', { name: 'Заметка' })).toHaveValue('Одна команда')
  fireEvent.click(screen.getByRole('button', { name: 'Повторить ту же команду' }))
  await screen.findByRole('button', { name: 'Проверить результат' })
  expect(calls).toHaveLength(2)
  expect(calls[1]).toEqual(calls[0])
})

it('filters the CRM users snapshot by status and name using the account URL', async () => {
  managerCard(
    () => {
      throw new Error('unexpected write')
    },
    () => ({ version: 1, note: null }),
  )
  fireEvent.click(await screen.findByRole('link', { name: 'Пользователи' }))
  expect(await screen.findByRole('cell', { name: 'Ирина' })).toBeVisible()
  expect(screen.getByRole('cell', { name: 'Алексей' })).toBeVisible()
  fireEvent.click(screen.getByRole('link', { name: 'Администраторы · 1' }))
  expect(new URLSearchParams(window.location.search).get('users_filter')).toBe('admins')
  expect(screen.getByRole('cell', { name: 'Ирина' })).toBeVisible()
  expect(screen.queryByRole('cell', { name: 'Алексей' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox', { name: 'Имя или ID пользователя' }), {
    target: { value: '10002' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Найти' }))
  expect(screen.getByText('Пользователи по фильтру не найдены.')).toBeVisible()
  fireEvent.click(screen.getByRole('link', { name: 'Все · 2' }))
  expect(screen.getByRole('cell', { name: 'Алексей' })).toBeVisible()
  expect(screen.queryByRole('cell', { name: 'Ирина' })).not.toBeInTheDocument()
})

it('previews the TOP classification and sends the package, deal and seat limit together', async () => {
  let version = 1
  let sent: unknown
  managerCard(
    (init) => {
      sent = JSON.parse(String(init?.body))
      version = 2
      return Response.json({ account_id: account, version }, { headers: { ETag: '"2"' } })
    },
    () => ({
      version,
      note: null,
      active_users: { state: 'fresh', value: 3, source: 'amoCRM' },
      ...(version === 2
        ? {
            classification: 'Наш клиент',
            subscription: {
              plan: 'top',
              seats: 3,
              deal_id: '123',
              ends_on: '2030-12-31',
              state: 'active',
              changed_at: '2026-11-25T00:00:00Z',
            },
          }
        : {}),
    }),
    true,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Выдать подписку' }))
  expect(screen.getByText(/После выдачи статус клиента изменится/)).toHaveTextContent('Наш клиент')
  expect(screen.getByLabelText('Лимит пользователей')).toHaveValue(3)
  expect(screen.getByRole('button', { name: 'Выдать' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Действует до'), { target: { value: '2030-12-31' } })
  fireEvent.change(screen.getByLabelText('Сделка в amoCRM — основание'), {
    target: { value: 'https://rakurscrm.amocrm.ru/leads/detail/123' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Выдать' }))
  expect(await screen.findByRole('link', { name: '№123 ↗' })).toHaveAttribute(
    'href',
    'https://rakurscrm.amocrm.ru/leads/detail/123',
  )
  expect(sent).toEqual({
    action: 'grant',
    plan: 'top',
    seats: 3,
    ends_on: '2030-12-31',
    deal_id: '123',
  })
})
