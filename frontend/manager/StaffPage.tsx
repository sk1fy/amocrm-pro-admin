import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { isApiError } from '../src/api/client'
import { createRequestKey } from '../src/features/operations/intents'
import { StatusBadge } from '../src/components/StatusBadge'
import { formatTime } from '../src/lib/format'
import { ManagerLink } from './accountsLocation'
import { ReadFailure, useAccountAccessError, type AccountAccess } from './AccountsPage'
import {
  getStaff,
  grantCatalog,
  invitationResult,
  listStaff,
  sendStaffCommand,
  type Staff,
  type StaffCommand,
} from './staffApi'
import styles from './Accounts.module.css'
import staffStyles from './StaffPage.module.css'

type Props = AccountAccess & {
  search: string
  navigate: (search: string) => void
  grants: string[]
  managerId: string
}
export function staffSearch(search: string, updates: Record<string, string | null>) {
  const params = new URLSearchParams(search)
  for (const [key, value] of Object.entries(updates)) {
    if (value) params.set('staff_' + key, value)
    else params.delete('staff_' + key)
  }
  params.set('section', 'staff')
  return params.toString()
}
function querySearch(search: string) {
  const params = new URLSearchParams(search)
  const query = new URLSearchParams({ limit: '25' })
  for (const key of ['search', 'limit', 'cursor']) {
    const value = params.get('staff_' + key)
    if (value) query.set(key, value)
  }
  return query.toString()
}
const grantNames: Record<string, string> = {
  'clients.read': 'Просмотр клиентов',
  'clients.write': 'Изменение клиентов',
  'clients.renew': 'Продление доступа',
  'catalog.read': 'Доступ к виджетам',
  'catalog.manage': 'Управление виджетами',
  'configuration.manage': 'Настройки',
  'feed.read': 'Лента событий',
  'staff.manage': 'Управление сотрудниками',
  'identity.manage': 'Приглашения и сеансы',
  'security.audit.read': 'Просмотр аудита',
  'stats.read': 'Метрики виджетов',
}
const grantGroups = [
  { id: 'clients', label: 'Клиенты', grants: ['clients.read', 'clients.write'] },
  { id: 'renewal', label: 'Продление', grants: ['clients.renew'] },
  { id: 'feed', label: 'Лента и метрики', grants: ['feed.read', 'stats.read'] },
  {
    id: 'management',
    label: 'Управление',
    grants: [
      'catalog.read',
      'catalog.manage',
      'configuration.manage',
      'staff.manage',
      'identity.manage',
      'security.audit.read',
    ],
  },
]
const groupedGrants = new Set(grantGroups.flatMap((group) => group.grants))
const groupLabels: Record<string, string> = {
  'clients.read': 'Просмотр',
  'clients.write': 'Изменение',
  'clients.renew': 'Доступ',
  'catalog.read': 'Виджеты',
  'security.audit.read': 'Просмотр аудита',
}
function toggleGrant(grants: string[], grant: string, checked: boolean) {
  return checked ? [...grants, grant] : grants.filter((value) => value !== grant)
}

function AccessValue({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <span className={staffStyles.accessValue}>
      {label} <span data-enabled={enabled}>{enabled ? 'Да' : 'Нет'}</span>
    </span>
  )
}
function Grants({
  catalog,
  selected,
  onChange,
  disabled,
  own,
}: {
  catalog: string[]
  selected: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
  own?: string[]
}) {
  return (
    <fieldset disabled={disabled} className={staffStyles.grants}>
      <legend>Права в кабинете менеджеров</legend>
      {[
        ...grantGroups,
        { label: 'Другие права', grants: catalog.filter((grant) => !groupedGrants.has(grant)) },
      ].map((group) => {
        const grants = group.grants.filter((grant) => catalog.includes(grant))
        if (grants.length === 0) return null
        return (
          <div key={group.label} className={staffStyles.grantGroup}>
            <strong>{group.label}</strong>
            {grants.map((grant) => (
              <label key={grant} className={staffStyles.choice}>
                <span>{grantNames[grant] ?? 'Неизвестное право'}</span>
                <input
                  type="checkbox"
                  role="switch"
                  className={staffStyles.switch}
                  checked={selected.includes(grant)}
                  disabled={own !== undefined && !own.includes(grant)}
                  onChange={(event) =>
                    onChange(toggleGrant(selected, grant, event.currentTarget.checked))
                  }
                />
              </label>
            ))}
          </div>
        )
      })}
    </fieldset>
  )
}
type Attempt =
  | { kind: 'idle' }
  | { kind: 'pending' | 'unknown'; command: StaffCommand }
  | { kind: 'failed'; message: string; conflict: boolean }
  | { kind: 'done'; link: string | null; unavailable: boolean }
function commandErrorMessage(code: string | undefined, status: number) {
  switch (code) {
    case 'version_conflict':
      return 'Данные изменились. Черновик сохранён. Обновите сотрудника и явно выберите новую версию.'
    case 'email_exists':
      return 'Сотрудник с таким email уже существует. Найдите его в списке и измените менеджерские права.'
    case 'last_administrator':
      return 'Нельзя отозвать доступ последнего администратора. Сначала назначьте другого администратора.'
    case 'self_escalation':
      return 'Нельзя добавлять права собственной учётной записи.'
    case 'invitation_unavailable':
      return 'Перевыпуск недоступен. Обновите сотрудника: приглашение могло быть уже принято.'
    case 'idempotency_conflict':
      return 'Команда с таким ключом уже содержит другие данные. Обновите сотрудника и проверьте результат.'
    default:
      return status === 403
        ? 'Недостаточно прав для действия.'
        : 'Действие отклонено. Проверьте данные и права.'
  }
}
function useStaffCommand(props: AccountAccess) {
  const client = useQueryClient()
  const [attempt, setAttempt] = useState<Attempt>({ kind: 'idle' })
  async function execute(command: StaffCommand) {
    setAttempt({ kind: 'pending', command })
    try {
      const result = await sendStaffCommand(command)
      client.setQueryData<Staff>(['managers', 'staff', props.scope, result.staff.id], (current) =>
        current && current.version > result.staff.version ? current : result.staff,
      )
      client.setQueriesData<Awaited<ReturnType<typeof listStaff>>>(
        { queryKey: ['managers', 'staff', props.scope, 'list'] },
        (page) =>
          page && {
            ...page,
            items: page.items.map((staff) =>
              staff.id === result.staff.id && staff.version <= result.staff.version
                ? result.staff
                : staff,
            ),
          },
      )
      setAttempt({ kind: 'done', ...invitationResult(result) })
      void client.invalidateQueries({ queryKey: ['managers', 'staff'] })
      return result
    } catch (error) {
      if (!isApiError(error) || error.status >= 500 || error.status === 408)
        setAttempt({ kind: 'unknown', command })
      else {
        if (error.status === 401) props.onExpired()
        if (error.status === 403) props.onForbidden()
        if (error.status === 409) void client.invalidateQueries({ queryKey: ['managers', 'staff'] })
        setAttempt({
          kind: 'failed',
          conflict: error.detailCode === 'version_conflict',
          message: commandErrorMessage(error.detailCode, error.status),
        })
      }
    }
  }
  return {
    attempt,
    execute,
    busy: attempt.kind === 'pending' || attempt.kind === 'unknown',
    reset: () => setAttempt({ kind: 'idle' }),
  }
}
function CommandResult({ command }: { command: ReturnType<typeof useStaffCommand> }) {
  const { attempt } = command
  if (attempt.kind === 'pending') return <p role="status">Выполняем действие…</p>
  if (attempt.kind === 'unknown')
    return (
      <div role="alert">
        <p>
          Результат неизвестен. Обновите сотрудника для проверки. Точный повтор использует прежние
          данные и ключ.
        </p>
        <button type="button" onClick={() => void command.execute(attempt.command)}>
          Повторить прежнюю команду
        </button>
      </div>
    )
  if (attempt.kind === 'failed') return <p role="alert">{attempt.message}</p>
  if (attempt.kind === 'done')
    return (
      <div className={staffStyles.commandResult}>
        <p role="status">Действие выполнено.</p>
        {attempt.link ? (
          <>
            <p>
              Скопируйте ссылку сейчас. Она показывается один раз. Передайте её сотруднику
              самостоятельно.
            </p>
            <label>
              Ссылка приглашения
              <input readOnly value={attempt.link} onFocus={(event) => event.target.select()} />
            </label>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(attempt.link ?? '')}
            >
              Скопировать ссылку
            </button>
          </>
        ) : attempt.unavailable ? (
          <p>
            Ссылка недоступна после повтора команды. Обновите сотрудника и явно перевыпустите
            ожидающее приглашение.
          </p>
        ) : null}
      </div>
    )
  return null
}
function sameGrants(left: string[], right: string[]) {
  return left.length === right.length && left.every((grant) => right.includes(grant))
}

function useGrantDraft(staff: Staff, command: ReturnType<typeof useStaffCommand>) {
  const [draft, setDraft] = useState<{ grants: string[]; version: number } | null>(null)
  const commandConflict = command.attempt.kind === 'failed' && command.attempt.conflict
  if (draft && sameGrants(draft.grants, staff.grants)) {
    setDraft(null)
    if (commandConflict) command.reset()
  }
  const grants = draft?.grants ?? staff.grants
  const version = draft?.version ?? staff.version
  const changedOnServer = draft !== null && staff.version > version
  const conflict = changedOnServer || commandConflict
  return {
    draft,
    grants,
    version,
    changedOnServer,
    commandConflict,
    conflict,
    change(next: string[]) {
      if (!draft && commandConflict) command.reset()
      setDraft(sameGrants(next, staff.grants) ? null : { grants: next, version })
    },
    discard() {
      setDraft(null)
      command.reset()
    },
    rebase() {
      if (draft) setDraft({ ...draft, version: staff.version })
      command.reset()
    },
  }
}

function StaffEditor({ staff, catalog, props }: { staff: Staff; catalog: string[]; props: Props }) {
  const [confirm, setConfirm] = useState(false)
  const command = useStaffCommand(props)
  const identity = props.grants.includes('identity.manage')
  const {
    draft,
    grants,
    version,
    changedOnServer,
    commandConflict,
    conflict,
    change,
    discard,
    rebase,
  } = useGrantDraft(staff, command)
  async function send(path: string, body: unknown, method: 'PATCH' | 'POST' = 'POST') {
    await command.execute({
      path: '/' + staff.id + path,
      method,
      body: JSON.stringify(body),
      key: createRequestKey(),
      ...(path === '/sessions/revoke' ? {} : { version }),
    })
  }
  return (
    <section className={staffStyles.surface}>
      <header className={staffStyles.heading}>
        <div>
          <h2>{staff.name}</h2>
          <p className={styles.meta}>
            {staff.email}
            {staff.id === props.managerId ? ' · Это вы' : ''}
          </p>
        </div>
        <StatusBadge domain="manager_staff" state={staff.status} calm />
      </header>
      <p className={styles.meta}>
        Версия {staff.version} · изменено {formatTime(staff.changed_at)} · автор{' '}
        {staff.changed_by ?? '—'}
      </p>
      <form
        className={staffStyles.commandForm}
        onSubmit={(event) => {
          event.preventDefault()
          if (draft && !command.busy && !conflict) void send('', { grants: draft.grants }, 'PATCH')
        }}
      >
        <Grants
          catalog={catalog}
          selected={grants}
          onChange={change}
          disabled={command.busy}
          own={staff.id === props.managerId ? props.grants : undefined}
        />
        <p className={styles.meta}>Сохранение прав завершает менеджерские сеансы сотрудника.</p>
        <button data-variant="primary" disabled={!draft || command.busy || conflict}>
          Сохранить права
        </button>
      </form>
      {conflict && draft && !command.busy ? (
        <>
          {changedOnServer && !commandConflict ? (
            <p role="alert">Права сотрудника изменились. Ваш черновик сохранён.</p>
          ) : null}
          <div className={staffStyles.staffActions}>
            <button type="button" disabled={!changedOnServer} onClick={rebase}>
              Использовать обновлённую версию {staff.version}, сохранив черновик
            </button>
            <button type="button" onClick={discard}>
              Отбросить черновик
            </button>
          </div>
        </>
      ) : null}
      <div className={staffStyles.staffActions}>
        {identity && staff.status === 'invited' ? (
          <button
            type="button"
            disabled={command.busy}
            onClick={() => send('/invitation/reissue', {})}
          >
            Перевыпустить приглашение
          </button>
        ) : null}
        {identity ? (
          <>
            <button type="button" disabled={command.busy} onClick={() => setConfirm(true)}>
              Завершить менеджерские сеансы
            </button>
            {confirm ? (
              <div role="group" aria-label="Подтверждение завершения сеансов">
                <p>
                  Завершить все сеансы {staff.name} только в кабинете менеджеров (managers)?
                  Сотруднику потребуется войти снова.
                </p>
                <button
                  type="button"
                  disabled={command.busy}
                  onClick={() => {
                    setConfirm(false)
                    send('/sessions/revoke', {})
                  }}
                >
                  Подтвердить завершение
                </button>
                <button type="button" onClick={() => setConfirm(false)}>
                  Отмена
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      <CommandResult command={command} />
    </section>
  )
}
function InviteForm({ catalog, props, open }: { catalog: string[]; props: Props; open: boolean }) {
  const [grants, setGrants] = useState<string[]>([])
  const command = useStaffCommand(props)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void command.execute({
      path: '',
      method: 'POST',
      key: createRequestKey(),
      body: JSON.stringify({
        email: String(form.get('email') ?? '').trim(),
        name: String(form.get('name') ?? '').trim(),
        grants,
      }),
    })
  }
  return (
    <section
      className={`${staffStyles.surface} ${staffStyles.invite}`}
      id="staff-invitation"
      aria-labelledby="staff-invitation-title"
      hidden={!open}
    >
      <header>
        <h2 id="staff-invitation-title">Пригласить сотрудника</h2>
        <p>Выберите права. Сотрудник задаст пароль по ссылке приглашения.</p>
      </header>
      <form onSubmit={submit} className={staffStyles.commandForm}>
        <div className={staffStyles.inviteFields}>
          <label>
            Имя
            <input name="name" autoComplete="off" required disabled={command.busy} />
          </label>
          <label>
            Email
            <input type="email" name="email" autoComplete="off" required disabled={command.busy} />
          </label>
        </div>
        <Grants catalog={catalog} selected={grants} onChange={setGrants} disabled={command.busy} />
        <div className={staffStyles.inviteActions}>
          <button data-variant="primary" disabled={command.busy || grants.length === 0}>
            Создать приглашение
          </button>
        </div>
      </form>
      <CommandResult command={command} />
    </section>
  )
}

function StaffRow({ staff, catalog, props }: { staff: Staff; catalog?: string[]; props: Props }) {
  const command = useStaffCommand(props)
  const {
    draft,
    grants,
    version,
    changedOnServer,
    commandConflict,
    conflict,
    change,
    discard,
    rebase,
  } = useGrantDraft(staff, command)
  const own = staff.id === props.managerId
  const canToggle =
    !own && (staff.status === 'active' || (staff.status === 'revoked' && staff.grants.length > 0))
  function patch(body: { grants: string[] } | { access_enabled: boolean }) {
    return command.execute({
      path: '/' + staff.id,
      method: 'PATCH',
      body: JSON.stringify(body),
      key: createRequestKey(),
      version,
    })
  }
  return (
    <tr>
      <th scope="row">
        <ManagerLink search={staffSearch(props.search, { id: staff.id })} navigate={props.navigate}>
          {staff.name}
        </ManagerLink>
        <span className={staffStyles.employeeContact}>
          {staff.email}
          {own ? ' · Это вы' : ''}
        </span>
        {draft && !command.busy ? (
          <div className={staffStyles.rowActions}>
            {changedOnServer && !commandConflict ? (
              <p role="alert">Права изменились. Черновик сохранён.</p>
            ) : null}
            {conflict ? (
              <button type="button" disabled={!changedOnServer} onClick={rebase}>
                Использовать новую версию
              </button>
            ) : (
              <button type="button" data-variant="primary" onClick={() => void patch({ grants })}>
                Сохранить права
              </button>
            )}
            <button type="button" data-variant="ghost" onClick={discard}>
              Отмена
            </button>
          </div>
        ) : null}
        {command.attempt.kind !== 'done' ? <CommandResult command={command} /> : null}
      </th>
      <td>
        <div className={staffStyles.access}>
          {canToggle ? (
            <input
              type="checkbox"
              role="switch"
              className={staffStyles.switch}
              aria-label={`Менеджерский доступ — ${staff.name}`}
              checked={staff.status === 'active'}
              disabled={command.busy || Boolean(draft)}
              onChange={(event) => void patch({ access_enabled: event.currentTarget.checked })}
            />
          ) : null}
          <StatusBadge domain="manager_staff" state={staff.status} calm />
        </div>
      </td>
      {grantGroups.map((group) => (
        <td key={group.id}>
          {group.id === 'feed' ? (
            <div className={staffStyles.rowGrants}>
              <AccessValue label="Лента" enabled={staff.grants.includes('feed.read')} />
              <AccessValue label="Метрики" enabled={staff.grants.includes('stats.read')} />
            </div>
          ) : (
            <div className={staffStyles.rowGrants}>
              {(group.id === 'management'
                ? ['catalog.read', 'security.audit.read']
                : group.grants
              ).map((grant) => (
                <label className={staffStyles.rowGrant} key={grant}>
                  <input
                    type="checkbox"
                    role="switch"
                    className={staffStyles.switch}
                    aria-label={grantNames[grant]}
                    checked={grants.includes(grant)}
                    disabled={own || command.busy || !catalog?.includes(grant)}
                    onChange={(event) =>
                      change(toggleGrant(grants, grant, event.currentTarget.checked))
                    }
                  />
                  {groupLabels[grant]}
                </label>
              ))}
            </div>
          )}
        </td>
      ))}
    </tr>
  )
}

export function StaffPage(props: Props) {
  const params = new URLSearchParams(props.search)
  const canManage = props.grants.includes('staff.manage')
  const selected = params.get('staff_id')
  const query = querySearch(props.search)
  const list = useQuery({
    queryKey: ['managers', 'staff', props.scope, 'list', query],
    queryFn: ({ signal }) => listStaff(query, signal),
    enabled: canManage && !selected,
    retry: false,
  })
  const catalog = useQuery({
    queryKey: ['managers', 'staff', props.scope, 'grants'],
    queryFn: ({ signal }) => grantCatalog(signal),
    enabled: canManage,
    retry: false,
  })
  const detail = useQuery({
    queryKey: ['managers', 'staff', props.scope, selected],
    queryFn: ({ signal }) => getStaff(selected ?? '', signal),
    enabled: canManage && Boolean(selected),
    retry: false,
  })
  useAccountAccessError(
    list.error ?? catalog.error ?? detail.error,
    props.onExpired,
    props.onForbidden,
  )
  const [inviteOpen, setInviteOpen] = useState(false)
  const canInvite = canManage && props.grants.includes('identity.manage') && !!catalog.data
  const limit = new URLSearchParams(query).get('limit') ?? '25'
  const limits = [...new Set(['25', '50', '100', limit])].sort((a, b) => Number(a) - Number(b))
  const next = list.data?.next_cursor
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    props.navigate(
      staffSearch(props.search, {
        search: String(values.get('search') ?? ''),
        cursor: null,
      }),
    )
  }
  return (
    <section className={`${styles.workspace} ${staffStyles.workspace}`}>
      <header className={staffStyles.heading}>
        <div>
          <h1>Сотрудники</h1>
          {canManage && !selected ? (
            <p className={styles.meta}>
              Права можно изменить в строке сотрудника. Сохранение прав и выключение доступа
              завершают менеджерские сеансы.
            </p>
          ) : null}
        </div>
        {canManage && !selected ? (
          <div className={staffStyles.staffActions}>
            <button type="button" onClick={() => void list.refetch()} disabled={list.isFetching}>
              Обновить список сотрудников
            </button>
            {canInvite ? (
              <button
                type="button"
                data-variant="primary"
                aria-expanded={inviteOpen}
                aria-controls="staff-invitation"
                onClick={() => setInviteOpen(!inviteOpen)}
              >
                Пригласить сотрудника
              </button>
            ) : null}
          </div>
        ) : null}
      </header>
      {canManage ? (
        <>
          {selected ? (
            <>
              <div className={staffStyles.staffActions}>
                <ManagerLink
                  search={staffSearch(props.search, { id: null })}
                  navigate={props.navigate}
                >
                  К списку сотрудников
                </ManagerLink>
                {detail.data ? (
                  <button
                    type="button"
                    onClick={() => void detail.refetch()}
                    disabled={detail.isFetching}
                  >
                    Обновить сотрудника
                  </button>
                ) : null}
              </div>
              {detail.isPending ? (
                <p role="status">Загружаем сотрудника…</p>
              ) : detail.isError ? (
                <ReadFailure error={detail.error} retry={() => void detail.refetch()} />
              ) : catalog.data ? (
                <StaffEditor
                  key={detail.data.id}
                  staff={detail.data}
                  catalog={catalog.data}
                  props={props}
                />
              ) : null}
            </>
          ) : (
            <>
              {canInvite && catalog.data ? (
                <InviteForm catalog={catalog.data} props={props} open={inviteOpen} />
              ) : null}
              <form
                onSubmit={filter}
                key={params.get('staff_search')}
                className={staffStyles.search}
              >
                <input
                  name="search"
                  type="search"
                  aria-label="Поиск сотрудников"
                  placeholder="Имя или email"
                  defaultValue={params.get('staff_search') ?? ''}
                />
                <button>Найти</button>
              </form>
              {list.isPending ? (
                <p role="status">Загружаем сотрудников…</p>
              ) : (
                <div className={staffStyles.directory}>
                  {list.isError ? (
                    <div className={staffStyles.panelMessage}>
                      <ReadFailure error={list.error} retry={() => void list.refetch()} />
                    </div>
                  ) : (
                    <div
                      className={staffStyles.tableScroll}
                      role="region"
                      aria-label="Список сотрудников"
                      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Enable horizontal keyboard scrolling.
                      tabIndex={0}
                    >
                      <table className={staffStyles.table} aria-label="Доступ сотрудников">
                        <thead>
                          <tr>
                            <th scope="col">Сотрудник</th>
                            <th scope="col">Менеджерский доступ</th>
                            {grantGroups.map((group) => (
                              <th key={group.label} scope="col">
                                {group.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {list.data.items.map((staff) => (
                            <StaffRow
                              key={staff.id}
                              staff={staff}
                              catalog={catalog.data}
                              props={props}
                            />
                          ))}
                          {list.data.items.length === 0 ? (
                            <tr>
                              <td colSpan={2 + grantGroups.length}>Сотрудники не найдены</td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className={staffStyles.pager}>
                    <label>
                      Строк на странице
                      <select
                        value={limit}
                        onChange={(event) =>
                          props.navigate(
                            staffSearch(props.search, {
                              limit: event.target.value,
                              cursor: null,
                            }),
                          )
                        }
                      >
                        {limits.map((size) => (
                          <option key={size}>{size}</option>
                        ))}
                      </select>
                    </label>
                    {params.has('staff_cursor') ? (
                      <button
                        type="button"
                        onClick={() => props.navigate(staffSearch(props.search, { cursor: null }))}
                      >
                        Первая страница
                      </button>
                    ) : null}
                    {next ? (
                      <button
                        type="button"
                        onClick={() => props.navigate(staffSearch(props.search, { cursor: next }))}
                      >
                        Следующая страница
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </>
          )}
          {catalog.isError ? (
            <ReadFailure error={catalog.error} retry={() => void catalog.refetch()} />
          ) : null}
        </>
      ) : (
        <p>Нет доступа к управлению сотрудниками.</p>
      )}
    </section>
  )
}
