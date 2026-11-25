import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ManagerApp } from './ManagerApp'
import { captureInvitation } from './AcceptInvitationPage'
import { StaffPage, staffSearch } from './StaffPage'
import { parseStaff, getStaff } from './staffApi'
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
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
})
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
it('shows assigned grants, preserves paging filters and opens invitation without writing', async () => {
  const navigate = vi.fn()
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    if (String(input).endsWith('/grants'))
      return Response.json({ items: ['clients.read', 'feed.read'] })
    return Response.json({ items: [staff], next_cursor: 'next-staff' })
  })
  vi.stubGlobal('fetch', fetcher)
  wrap(
    <StaffPage
      scope="staff-list"
      managerId={id}
      grants={['staff.manage', 'identity.manage', 'security.audit.read']}
      search="section=staff&staff_search=example&staff_cursor=previous"
      navigate={navigate}
      onExpired={vi.fn()}
      onForbidden={vi.fn()}
    />,
  )
  const table = await screen.findByRole('table', { name: 'Доступ сотрудников' })
  expect(within(table).getByText('employee@example.invalid · Это вы')).toBeInTheDocument()
  expect(within(table).getByText('Доступ открыт')).toBeInTheDocument()
  expect(within(table).getByRole('switch', { name: 'Просмотр клиентов' })).toBeChecked()
  expect(within(table).getByRole('switch', { name: 'Изменение клиентов' })).not.toBeChecked()
  expect(within(table).queryByRole('switch', { name: 'Лента событий' })).not.toBeInTheDocument()
  expect(within(table).getByText('Лента').parentElement).toHaveTextContent('Лента Нет')
  expect(within(table).getByText('Метрики').parentElement).toHaveTextContent('Метрики Нет')
  expect(within(table).getByRole('switch', { name: 'Доступ к виджетам' })).not.toBeChecked()

  fireEvent.click(screen.getByRole('button', { name: 'Следующая страница' }))
  const next = new URLSearchParams(navigate.mock.calls.at(-1)?.[0])
  expect(next.get('staff_search')).toBe('example')
  expect(next.get('staff_cursor')).toBe('next-staff')

  fireEvent.change(screen.getByLabelText('Строк на странице'), { target: { value: '50' } })
  const changed = new URLSearchParams(navigate.mock.calls.at(-1)?.[0])
  expect(changed.get('staff_search')).toBe('example')
  expect(changed.get('staff_limit')).toBe('50')
  expect(changed.has('staff_cursor')).toBe(false)

  const invite = screen.getByRole('button', { name: 'Пригласить сотрудника' })
  expect(invite).toHaveAttribute('aria-haspopup', 'dialog')
  expect(invite).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('dialog', { name: 'Пригласить сотрудника' })).not.toBeInTheDocument()
  fireEvent.click(invite)
  expect(invite).toHaveAttribute('aria-expanded', 'true')
  const invitation = screen.getByRole('dialog', { name: 'Пригласить сотрудника' })
  expect(invitation).toBeVisible()
  expect(within(invitation).getByRole('heading', { name: 'Пригласить сотрудника' })).toBeVisible()
  expect(within(invitation).getByRole('button', { name: 'Создать приглашение' })).toBeDisabled()
  expect(within(invitation).getByRole('switch', { name: 'Просмотр клиентов' })).not.toBeChecked()
  fireEvent.click(within(invitation).getByRole('button', { name: 'Отмена' }))
  expect(screen.queryByRole('dialog', { name: 'Пригласить сотрудника' })).not.toBeInTheDocument()
  expect(invite).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('heading', { name: 'Аудит безопасности' })).not.toBeInTheDocument()
  expect(
    fetcher.mock.calls.every(
      ([input, init]) =>
        !String(input).includes('/security/audit') &&
        (init?.method === undefined || init.method === 'GET'),
    ),
  ).toBe(true)
})

async function submitInvitation() {
  wrap(
    <StaffPage
      scope="invite-modal"
      managerId={id}
      grants={['staff.manage', 'identity.manage']}
      search="section=staff"
      navigate={vi.fn()}
      onExpired={vi.fn()}
      onForbidden={vi.fn()}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Пригласить сотрудника' }))
  const dialog = await screen.findByRole('dialog', { name: 'Пригласить сотрудника' })
  fireEvent.change(within(dialog).getByLabelText('Имя'), { target: { value: 'Новый менеджер' } })
  fireEvent.change(within(dialog).getByLabelText('Email'), {
    target: { value: 'new@example.invalid' },
  })
  fireEvent.click(within(dialog).getByRole('switch', { name: 'Просмотр клиентов' }))
  const submit = within(dialog).getByRole('button', { name: 'Создать приглашение' })
  expect(submit).toBeEnabled()
  fireEvent.click(submit)
  return dialog
}

it('creates an invitation in the modal dialog and allows inviting another employee', async () => {
  const invited = {
    ...staff,
    id: '8a1f0dc6-4090-4a8e-8a39-7c87be5cf34d',
    email: 'new@example.invalid',
    name: 'Новый менеджер',
    status: 'invited',
    grants: ['clients.read'],
  }
  const posts: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/grants'))
        return Response.json({ items: ['clients.read', 'feed.read'] })
      if (init?.method === 'POST') {
        posts.push(String(init.body))
        return Response.json(
          {
            staff: invited,
            invitation_url: window.location.origin + '/managers#invitation=fixture',
            link_unavailable: false,
          },
          { status: 201 },
        )
      }
      return Response.json({ items: [staff], next_cursor: null })
    }),
  )
  const dialog = await submitInvitation()
  await waitFor(() =>
    expect(within(dialog).getByLabelText('Ссылка приглашения')).toHaveValue(
      window.location.origin + '/managers#invitation=fixture',
    ),
  )
  expect(posts).toEqual([
    JSON.stringify({
      email: 'new@example.invalid',
      name: 'Новый менеджер',
      grants: ['clients.read'],
    }),
  ])
  const copy = within(dialog).getByRole('button', { name: 'Скопировать ссылку' })
  const linkField = within(dialog).getByLabelText<HTMLInputElement>('Ссылка приглашения')
  vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: undefined } }))
  fireEvent.click(copy)
  expect(await within(dialog).findByText('Скопируйте ссылку вручную из поля выше.')).toBeVisible()
  expect(linkField).toHaveFocus()
  expect(linkField.selectionEnd).toBe(linkField.value.length)

  const writeText = vi.fn<(link: string) => Promise<void>>()
  vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText } } }))
  writeText.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'))
  fireEvent.click(copy)
  expect(await within(dialog).findByText('Скопируйте ссылку вручную из поля выше.')).toBeVisible()
  expect(within(dialog).queryByText('Ссылка скопирована.')).not.toBeInTheDocument()

  let finishCopy!: () => void
  writeText.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishCopy = resolve
      }),
  )
  fireEvent.click(copy)
  expect(copy).toBeDisabled()
  expect(within(dialog).queryByText('Ссылка скопирована.')).not.toBeInTheDocument()
  finishCopy()
  expect(await within(dialog).findByText('Ссылка скопирована.')).toBeVisible()
  expect(writeText).toHaveBeenCalledWith(linkField.value)
  expect(within(dialog).getByRole('button', { name: 'Готово' })).toBeVisible()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Пригласить ещё' }))
  expect(within(dialog).getByLabelText('Имя')).toHaveValue('')
  expect(within(dialog).getByLabelText('Email')).toHaveValue('')
  expect(within(dialog).getByRole('button', { name: 'Создать приглашение' })).toBeDisabled()
})

it('retains the invitation and retries its exact request after closing an unknown result', async () => {
  const requests: Array<{ body: BodyInit | null | undefined; key: string | null }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/grants')) return Response.json({ items: ['clients.read'] })
      if (init?.method === 'POST') {
        requests.push({ body: init.body, key: new Headers(init.headers).get('Idempotency-Key') })
        if (requests.length === 1) throw new TypeError('connection lost')
        return Response.json({ staff, link_unavailable: true })
      }
      return Response.json({ items: [staff], next_cursor: null })
    }),
  )
  let dialog = await submitInvitation()
  await within(dialog).findByRole('button', { name: 'Повторить прежнюю команду' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть окно приглашения' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Пригласить сотрудника' }))
  dialog = await screen.findByRole('dialog', { name: 'Пригласить сотрудника' })
  expect(within(dialog).getByLabelText('Email')).toHaveValue('new@example.invalid')
  expect(within(dialog).getByLabelText('Имя')).toBeDisabled()
  expect(within(dialog).getByRole('switch', { name: 'Просмотр клиентов' })).toBeChecked()
  expect(within(dialog).getByRole('button', { name: 'Создать приглашение' })).toBeDisabled()
  expect(requests).toHaveLength(1)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Повторить прежнюю команду' }))
  expect(await within(dialog).findByText(/Ссылка недоступна после повтора/)).toBeVisible()
  expect(requests).toHaveLength(2)
  expect(requests[0]?.key).toMatch(/^[0-9a-f-]{36}$/)
  expect(requests[1]).toEqual(requests[0])
})

it('saves individual right switches once per row and retains the other grants', async () => {
  let current = {
    ...staff,
    grants: ['clients.read', 'clients.renew', 'feed.read', 'catalog.manage'],
  }
  const writes: { grants: string[]; version: string | null }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/grants'))
        return Response.json({
          items: [
            'clients.read',
            'clients.write',
            'clients.renew',
            'feed.read',
            'catalog.manage',
            'catalog.read',
            'security.audit.read',
          ],
        })
      if (init?.method === 'PATCH') {
        const grants = (JSON.parse(String(init.body)) as { grants: string[] }).grants
        writes.push({ grants, version: new Headers(init.headers).get('If-Match') })
        current = { ...current, grants, version: 2 }
        return Response.json({ staff: current, link_unavailable: false })
      }
      return Response.json({ items: [current], next_cursor: null })
    }),
  )
  wrap(
    <StaffPage
      scope="row-grants"
      managerId="another-actor"
      grants={['staff.manage']}
      search="section=staff"
      navigate={vi.fn()}
      onExpired={vi.fn()}
      onForbidden={vi.fn()}
    />,
  )
  const table = await screen.findByRole('table', { name: 'Доступ сотрудников' })
  const edit = within(table).getByRole('switch', { name: 'Доступ к виджетам' })
  const audit = within(table).getByRole('switch', { name: 'Просмотр аудита' })
  await waitFor(() => expect(edit).toBeEnabled())
  fireEvent.click(edit)
  fireEvent.click(audit)
  expect(writes).toHaveLength(0)
  expect(within(table).getByRole('switch', { name: /Менеджерский доступ/ })).toBeDisabled()
  fireEvent.click(within(table).getByRole('button', { name: 'Сохранить права' }))
  await waitFor(() =>
    expect(writes).toEqual([
      {
        grants: [
          'clients.read',
          'clients.renew',
          'feed.read',
          'catalog.manage',
          'catalog.read',
          'security.audit.read',
        ],
        version: '"1"',
      },
    ]),
  )
  await waitFor(() => expect(edit).toBeEnabled())
  expect(edit).toBeChecked()
  expect(audit).toBeChecked()
  expect(within(table).queryByRole('button', { name: 'Сохранить права' })).not.toBeInTheDocument()
})
it('does not load the staff page or audit for an audit-only reader', async () => {
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
  expect(await screen.findByText('Нет доступа к управлению сотрудниками.')).toBeVisible()
  expect(fetcher).not.toHaveBeenCalled()
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
it('refreshes clean grants and preserves pending changes across a newer server version', async () => {
  let current = staff
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/grants'))
        return Response.json({ items: ['clients.read', 'feed.read', 'stats.read'] })
      return Response.json(current, { headers: { ETag: '"' + current.version + '"' } })
    }),
  )
  wrap(
    <StaffPage
      scope="staff-refresh"
      managerId="another-actor"
      grants={['staff.manage']}
      search={'section=staff&staff_id=' + id}
      navigate={vi.fn()}
      onExpired={vi.fn()}
      onForbidden={vi.fn()}
    />,
  )
  const feed = await screen.findByLabelText('Лента событий')
  const metrics = screen.getByLabelText('Метрики виджетов')
  const refresh = screen.getByRole('button', { name: 'Обновить сотрудника' })
  const save = screen.getByRole('button', { name: 'Сохранить права' })
  current = { ...staff, version: 2, grants: ['clients.read', 'feed.read'] }
  fireEvent.click(refresh)
  await waitFor(() => expect(feed).toBeChecked())
  expect(save).toBeDisabled()

  fireEvent.click(metrics)
  expect(save).toBeEnabled()
  current = { ...staff, version: 3 }
  fireEvent.click(refresh)
  await screen.findByText('Права сотрудника изменились. Ваш черновик сохранён.')
  expect(feed).toBeChecked()
  expect(metrics).toBeChecked()
  expect(save).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Отбросить черновик' }))
  expect(feed).not.toBeChecked()
  expect(metrics).not.toBeChecked()
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
        current = { ...staff, version: 3, grants: ['clients.read', 'feed.read'] }
        return Response.json({ staff: current, link_unavailable: false })
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
  const feed = await screen.findByLabelText('Лента событий')
  expect(screen.getByRole('button', { name: 'Сохранить права' })).toBeDisabled()
  fireEvent.click(feed)
  expect(requests).toHaveLength(0)
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
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Сохранить права' })).toBeDisabled(),
  )
})

it('clears an outdated conflict when the server confirms the same rights', async () => {
  let current = staff
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/grants'))
        return Response.json({ items: ['clients.read', 'feed.read', 'stats.read'] })
      if (init?.method === 'PATCH') {
        current = { ...staff, version: 2, grants: ['clients.read', 'feed.read'] }
        return Response.json(
          {
            error: { code: 'conflict', message: 'version', details: { code: 'version_conflict' } },
          },
          { status: 409 },
        )
      }
      return Response.json(current, { headers: { ETag: '"' + current.version + '"' } })
    }),
  )
  wrap(
    <StaffPage
      scope="staff-same-grants"
      managerId="another-actor"
      grants={['staff.manage']}
      search={'section=staff&staff_id=' + id}
      navigate={vi.fn()}
      onExpired={vi.fn()}
      onForbidden={vi.fn()}
    />,
  )
  fireEvent.click(await screen.findByLabelText('Лента событий'))
  const save = screen.getByRole('button', { name: 'Сохранить права' })
  fireEvent.click(save)
  await screen.findByText(/Версия 2/)
  expect(save).toBeDisabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('Метрики виджетов'))
  expect(save).toBeEnabled()
})
