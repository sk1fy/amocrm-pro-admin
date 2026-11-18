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
  listStaffAudit,
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
function querySearch(search: string, audit = false) {
  const params = new URLSearchParams(search)
  const query = new URLSearchParams({ limit: '25' })
  for (const key of audit ? ['cursor'] : ['search', 'limit', 'cursor']) {
    const value = params.get('staff_' + (audit ? 'audit_' : '') + key)
    if (value) query.set(key, value)
  }
  return query.toString()
}
const grantNames: Record<string, string> = {
  'clients.read': 'Просмотр клиентов',
  'clients.write': 'Изменение клиентов',
  'clients.renew': 'Продление доступа',
  'catalog.manage': 'Управление виджетами',
  'configuration.manage': 'Настройки',
  'feed.read': 'Лента событий',
  'staff.manage': 'Управление сотрудниками',
  'identity.manage': 'Приглашения и сеансы',
  'security.audit.read': 'Просмотр аудита',
  'stats.read': 'Метрики виджетов',
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
      {catalog.map((grant) => (
        <label key={grant} className={staffStyles.choice}>
          <input
            type="checkbox"
            checked={selected.includes(grant)}
            disabled={own !== undefined && !own.includes(grant)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, grant]
                  : selected.filter((value) => value !== grant),
              )
            }
          />{' '}
          {grantNames[grant] ?? 'Неизвестное право'}
        </label>
      ))}
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
      <div role="status">
        <p>Действие выполнено.</p>
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
function StaffEditor({ staff, catalog, props }: { staff: Staff; catalog: string[]; props: Props }) {
  const [draft, setDraft] = useState(staff.grants)
  const [version, setVersion] = useState(staff.version)
  const [confirm, setConfirm] = useState(false)
  const command = useStaffCommand(props)
  const identity = props.grants.includes('identity.manage')
  const conflict = command.attempt.kind === 'failed' && command.attempt.conflict
  async function send(path: string, body: unknown, method: 'PATCH' | 'POST' = 'POST') {
    const result = await command.execute({
      path: '/' + staff.id + path,
      method,
      body: JSON.stringify(body),
      key: createRequestKey(),
      ...(path === '/sessions/revoke' ? {} : { version }),
    })
    if (result) setVersion(result.staff.version)
  }
  return (
    <section>
      <h2>{staff.name}</h2>
      <p>{staff.email}</p>
      <p>
        <StatusBadge domain="manager_staff" state={staff.status} calm />
      </p>
      <p>
        Версия {staff.version} · изменено {formatTime(staff.changed_at)} · автор{' '}
        {staff.changed_by ?? '—'}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          send('', { grants: draft }, 'PATCH')
        }}
      >
        <Grants
          catalog={catalog}
          selected={draft}
          onChange={setDraft}
          disabled={command.busy}
          own={staff.id === props.managerId ? props.grants : undefined}
        />
        <p>Пустой набор прав отзывает менеджерский доступ.</p>
        <button disabled={command.busy || conflict}>Сохранить права</button>
      </form>
      {conflict ? (
        <button
          type="button"
          disabled={staff.version <= version}
          onClick={() => {
            setVersion(staff.version)
            command.reset()
          }}
        >
          Использовать обновлённую версию {staff.version}, сохранив черновик
        </button>
      ) : null}
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
      <CommandResult command={command} />
    </section>
  )
}
function InviteForm({ catalog, props }: { catalog: string[]; props: Props }) {
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
    <section>
      <h2>Пригласить сотрудника</h2>
      <p>Приглашение открывает доступ в кабинет менеджеров.</p>
      <form onSubmit={submit} className={styles.form}>
        <label>
          Email
          <input type="email" name="email" required disabled={command.busy} />
        </label>
        <label>
          Имя
          <input name="name" required disabled={command.busy} />
        </label>
        <Grants catalog={catalog} selected={grants} onChange={setGrants} disabled={command.busy} />
        <button disabled={command.busy || grants.length === 0}>Создать приглашение</button>
      </form>
      <CommandResult command={command} />
    </section>
  )
}
function StaffAudit(props: Props) {
  const query = querySearch(props.search, true)
  const audit = useQuery({
    queryKey: ['managers', 'staff', props.scope, 'audit', query],
    queryFn: ({ signal }) => listStaffAudit(query, signal),
    retry: false,
  })
  useAccountAccessError(audit.error, props.onExpired, props.onForbidden)
  return (
    <section>
      <h2>Аудит безопасности</h2>
      {audit.isPending ? (
        <p role="status">Загружаем аудит…</p>
      ) : audit.isError ? (
        <ReadFailure error={audit.error} retry={() => void audit.refetch()} />
      ) : (
        <>
          <ul>
            {audit.data.items.map((item) => (
              <li key={item.id}>
                {formatTime(item.created_at)} · {auditAction(item.action)} · сотрудник{' '}
                {item.object_ref} · автор {item.actor_id ?? '—'}
              </li>
            ))}
          </ul>
          {audit.data.items.length === 0 ? <p>Событий нет</p> : null}
          {audit.data.next_cursor ? (
            <button
              type="button"
              onClick={() =>
                props.navigate(staffSearch(props.search, { audit_cursor: audit.data.next_cursor }))
              }
            >
              Следующие события
            </button>
          ) : null}
        </>
      )}
    </section>
  )
}
function auditAction(action: string) {
  const labels: Record<string, string> = {
    'manager.bootstrap': 'Первоначальное назначение администратора',
    'manager.staff.invite': 'Создание приглашения',
    'manager.staff.grants': 'Изменение менеджерских прав',
    'manager.staff.reissue': 'Перевыпуск приглашения',
    'manager.staff.revoke_sessions': 'Завершение менеджерских сеансов',
    'manager.invitation.accept': 'Принятие приглашения',
    'auth.login': 'Вход в кабинет',
    'auth.login_failed': 'Неудачный вход в кабинет',
    'auth.logout': 'Выход из кабинета',
  }
  return labels[action] ?? 'Событие безопасности'
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
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    props.navigate(
      staffSearch(props.search, {
        search: String(values.get('search') ?? ''),
        limit: String(values.get('limit') ?? '25'),
        cursor: null,
      }),
    )
  }
  return (
    <section className={styles.workspace}>
      <header className={styles.toolbar}>
        <h1>Сотрудники</h1>
        {canManage && !selected ? (
          <button type="button" onClick={() => void list.refetch()}>
            Обновить список сотрудников
          </button>
        ) : null}
      </header>
      {canManage ? (
        <>
          {selected ? (
            <>
              <ManagerLink
                search={staffSearch(props.search, { id: null })}
                navigate={props.navigate}
              >
                К списку сотрудников
              </ManagerLink>
              {detail.isPending ? (
                <p role="status">Загружаем сотрудника…</p>
              ) : detail.isError ? (
                <ReadFailure error={detail.error} retry={() => void detail.refetch()} />
              ) : catalog.data ? (
                <>
                  <button type="button" onClick={() => void detail.refetch()}>
                    Обновить сотрудника
                  </button>
                  <StaffEditor
                    key={detail.data.id}
                    staff={detail.data}
                    catalog={catalog.data}
                    props={props}
                  />
                </>
              ) : null}
            </>
          ) : (
            <>
              <form onSubmit={filter} key={query} className={styles.filters}>
                <label>
                  Поиск сотрудников
                  <input
                    name="search"
                    type="search"
                    defaultValue={params.get('staff_search') ?? ''}
                  />
                </label>
                <label>
                  Строк на странице
                  <input
                    type="number"
                    name="limit"
                    min="1"
                    max="100"
                    defaultValue={params.get('staff_limit') ?? '25'}
                  />
                </label>
                <button>Найти</button>
              </form>
              {list.isPending ? (
                <p role="status">Загружаем сотрудников…</p>
              ) : list.isError ? (
                <ReadFailure error={list.error} retry={() => void list.refetch()} />
              ) : (
                <>
                  <div className={styles.tableScroll}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Сотрудник</th>
                          <th>Email</th>
                          <th>Менеджерский доступ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.data.items.map((staff) => (
                          <tr key={staff.id}>
                            <td>
                              <ManagerLink
                                search={staffSearch(props.search, { id: staff.id })}
                                navigate={props.navigate}
                              >
                                {staff.name}
                              </ManagerLink>
                            </td>
                            <td>{staff.email}</td>
                            <td>
                              <StatusBadge domain="manager_staff" state={staff.status} calm />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {list.data.items.length === 0 ? <p>Сотрудники не найдены</p> : null}
                  {list.data.next_cursor ? (
                    <button
                      type="button"
                      onClick={() =>
                        props.navigate(staffSearch(props.search, { cursor: list.data.next_cursor }))
                      }
                    >
                      Следующая страница
                    </button>
                  ) : null}
                </>
              )}
              {params.has('staff_cursor') ? (
                <button
                  type="button"
                  onClick={() => props.navigate(staffSearch(props.search, { cursor: null }))}
                >
                  Первая страница
                </button>
              ) : null}
              {props.grants.includes('identity.manage') && catalog.data ? (
                <InviteForm catalog={catalog.data} props={props} />
              ) : null}
            </>
          )}
          {catalog.isError ? (
            <ReadFailure error={catalog.error} retry={() => void catalog.refetch()} />
          ) : null}
        </>
      ) : (
        <p>Нет доступа к управлению сотрудниками.</p>
      )}
      {props.grants.includes('security.audit.read') ? <StaffAudit {...props} /> : null}
    </section>
  )
}
