import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ManagerApp } from './ManagerApp'
import { captureInvitation } from './AcceptInvitationPage'
import { StaffPage, staffSearch } from './StaffPage'
import { parseStaff, listStaffAudit, getStaff } from './staffApi'
import { resetApiSession } from '../src/api/client'
const id = '535dfcc0-062c-42a2-88bd-e8906924da27'
const staff = {
  id,
  email: 'employee@example.invalid',
  name: 'Сотрудник',
  status: 'active',
  grants: ['clients.read'],
  version: 1,
  changed_at: '2026-11-17T10:00:00Z',
  changed_by: null,
}
function wrap(children: React.ReactNode) {
  return render(
    <StrictMode>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        {children}
      </QueryClientProvider>
    </StrictMode>,
  )
}
afterEach(() => {
  vi.unstubAllGlobals()
  resetApiSession()
  window.history.replaceState(null, '', '/managers')
})
it('validates staff DTO status, actor and versions at the response boundary', () => {
  expect(parseStaff(staff).id).toBe(id)
  for (const patch of [
    { status: 'administrator' },
    { changed_by: 'bad' },
    { version: 0 },
    { grants: [42] },
  ])
    expect(() => parseStaff({ ...staff, ...patch })).toThrow()
})
it('rejects detail with wrong ETag', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(staff, { headers: { ETag: '"2"' } })),
  )
  await expect(getStaff(id, new AbortController().signal)).rejects.toThrow()
})
it('reads integer audit IDs and rejects malformed IDs', async () => {
  const row = {
    id: 23,
    actor_id: null,
    action: 'manager.grants.updated',
    object_ref: id,
    created_at: staff.changed_at,
  }
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ items: [row], next_cursor: null }))
    .mockResolvedValueOnce(Response.json({ items: [{ ...row, id: '23' }], next_cursor: null }))
  vi.stubGlobal('fetch', fetcher)
  expect((await listStaffAudit('', new AbortController().signal)).items[0]?.id).toBe(23)
  await expect(listStaffAudit('', new AbortController().signal)).rejects.toThrow()
})
it('keeps independent URL filters and selected staff', () => {
  const search = staffSearch('section=clients&clients_q=test&staff_cursor=older', {
    id,
    search: 'имя',
  })
  expect(new URLSearchParams(search).get('clients_q')).toBe('test')
  expect(new URLSearchParams(search).get('staff_cursor')).toBe('older')
  expect(new URLSearchParams(search).get('staff_id')).toBe(id)
})
it('captures fragment before StrictMode and makes no session request before acceptance', async () => {
  window.history.replaceState(null, '', '/managers#invitation=fixture-token')
  const token = captureInvitation()
  expect(window.location.hash).toBe('')
  const fetcher = vi.fn(async (_input: RequestInfo | URL) => Response.json({ accepted: true }))
  vi.stubGlobal('fetch', fetcher)
  wrap(<ManagerApp initialInvitation={token} />)
  expect(
    screen.getByRole('heading', { name: 'Приглашение в кабинет менеджеров' }),
  ).toBeInTheDocument()
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Новый пароль'), {
    target: { value: 'fixture-password-long' },
  })
  fireEvent.change(screen.getByLabelText('Повторите пароль'), {
    target: { value: 'fixture-password-long' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Установить пароль' }))
  await screen.findByRole('button', { name: 'Перейти ко входу' })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/managers/auth/invitations/accept')
  expect(localStorage.length).toBe(0)
})
it('audit-only readers do not request staff or grant catalog', async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL) =>
    Response.json({ items: [], next_cursor: null }),
  )
  vi.stubGlobal('fetch', fetcher)
  wrap(
    <StaffPage
      scope="audit-only"
      managerId={id}
      grants={['security.audit.read']}
      search="section=staff"
      navigate={vi.fn()}
      onExpired={vi.fn()}
      onForbidden={vi.fn()}
    />,
  )
  await screen.findByText('Событий нет')
  await waitFor(() =>
    expect(fetcher.mock.calls.every((call) => String(call[0]).includes('/security/audit'))).toBe(
      true,
    ),
  )
})
it('retries invitation acceptance with the exact password, body and key after a lost reply', async () => {
  const requests: Array<{ path: string; body: BodyInit | null | undefined; key: string | null }> =
    []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      path: String(input),
      body: init?.body,
      key: new Headers(init?.headers).get('Idempotency-Key'),
    })
    if (requests.length === 1) throw new TypeError('connection lost')
    return Response.json({ accepted: true })
  })
  vi.stubGlobal('fetch', fetcher)
  wrap(<ManagerApp initialInvitation="fixture-token" />)
  fireEvent.change(screen.getByLabelText('Новый пароль'), {
    target: { value: 'fixture-password-long' },
  })
  fireEvent.change(screen.getByLabelText('Повторите пароль'), {
    target: { value: 'fixture-password-long' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Установить пароль' }))
  await screen.findByRole('button', { name: 'Повторить прежнюю команду' })
  expect(screen.getByLabelText('Новый пароль')).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить прежнюю команду' }))
  await screen.findByRole('button', { name: 'Перейти ко входу' })
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
  expect(requests[0]?.key).toMatch(/^[0-9a-f-]{36}$/)
  expect(sessionStorage.length).toBe(0)
})
it('retains grant draft after version conflict and requires explicit refresh/rebase', async () => {
  let current = staff
  const requests: Array<{ body: BodyInit | null | undefined; version: string | null }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/grants'))
        return Response.json({ items: ['clients.read', 'feed.read'] })
      if (init?.method === 'PATCH') {
        requests.push({ body: init.body, version: new Headers(init.headers).get('If-Match') })
        if (requests.length === 1) {
          current = { ...staff, version: 2 }
          return Response.json(
            {
              error: {
                code: 'conflict',
                message: 'version',
                details: { code: 'version_conflict' },
              },
            },
            { status: 409 },
          )
        }
        return Response.json({ staff: { ...current, version: 3 }, link_unavailable: false })
      }
      return Response.json(current, { headers: { ETag: '"' + current.version + '"' } })
    }),
  )
  wrap(
    <StaffPage
      scope="staff-manager"
      managerId="another-actor"
      grants={['staff.manage']}
      search={'section=staff&staff_id=' + id}
      navigate={vi.fn()}
      onExpired={vi.fn()}
      onForbidden={vi.fn()}
    />,
  )
  fireEvent.click(await screen.findByLabelText('Лента событий'))
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить права' }))
  const rebase = await screen.findByRole('button', {
    name: 'Использовать обновлённую версию 2, сохранив черновик',
  })
  expect(screen.getByLabelText('Лента событий')).toBeChecked()
  expect(screen.getByRole('button', { name: 'Сохранить права' })).toBeDisabled()
  fireEvent.click(rebase)
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить права' }))
  await waitFor(() => expect(requests).toHaveLength(2))
  expect(requests[0]?.version).toBe('"1"')
  expect(requests[1]?.version).toBe('"2"')
  expect(requests[1]?.body).toBe(requests[0]?.body)
})
