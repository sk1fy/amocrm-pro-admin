import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { resetApiSession } from '../src/api/client'
import {
  accountSearch,
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
) {
  window.history.replaceState(null, '', '/managers?' + accountSearch('section=clients', account))
  const dispatch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/v1/managers/me') return Response.json(manager)
    if (url === path + '/profile') return update(init)
    if (url !== path) throw new Error('unexpected request ' + url)
    const { version, note } = current()
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
        version,
        note,
        region: null,
        time_zone: null,
        amostart: unknown,
        capabilities: [{ action: 'account.profile', allowed: true }],
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
  fireEvent.change(await screen.findByRole('textbox', { name: 'Заметка' }), {
    target: { value },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Причина изменения' }), {
    target: { value: 'Причина' },
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
    classification: ['Без партнёра', 'Запрет работы'],
    cursor: 'opaque+/=',
    portrait: filter,
  })
  const request = getAccountSearch(query)
  expect(request.query.get('q')).toBe('pilot')
  expect(request.query.getAll('classification')).toEqual(['Без партнёра', 'Запрет работы'])
  expect(request.filter).toBe(filter)
  expect(request.query.get('cursor')).toBe('opaque+/=')
  expect(request.query.has('tab')).toBe(false)
  expect(listSearch(accountSearch(query, account, 'portrait'))).toBe(query)
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
  await screen.findByText('Сохранено.')
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
  fireEvent.click(screen.getByRole('link', { name: 'Сводка' }))
  expect(screen.getByRole('textbox', { name: 'Заметка' })).toHaveValue('Одна команда')
  fireEvent.click(screen.getByRole('button', { name: 'Повторить ту же команду' }))
  await screen.findByRole('button', { name: 'Проверить результат' })
  expect(calls).toHaveLength(2)
  expect(calls[1]).toEqual(calls[0])
})
