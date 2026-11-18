import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, type FormEvent } from 'react'
import { clearSession } from '../src/app/session'
import { BrandLogo } from '../src/components/BrandLogo'
import { loginErrorMessage } from '../src/states/login'
import { ManagerAccountCard } from './AccountCard'
import { AccountCommands } from './accountCommands'
import { ClientsPage } from './CompaniesPage'
import { getAccountLocation } from './accountsLocation'
import { Timeline } from './Timeline'
import { WidgetsPage } from './WidgetsPage'
import { InstallationsPage } from './InstallationsPage'
import { useManagerLocation } from './installationsLocation'
import { fetchManager, loginManager, logoutManager } from './session'
import styles from './ManagerApp.module.css'
import { StaffPage } from './StaffPage'
import { AcceptInvitationPage } from './AcceptInvitationPage'
import { Workspace, workspaceSection } from './Workspace'

const sessionKey = ['managers', 'me']

type LoginState = { kind: 'idle' } | { kind: 'pending' } | { kind: 'failed'; message: string }

export function ManagerApp({ initialInvitation = null }: { initialInvitation?: string | null }) {
  const [invitation, setInvitation] = useState(initialInvitation)
  return invitation !== null ? (
    <AcceptInvitationPage token={invitation} onAccepted={() => setInvitation(null)} />
  ) : (
    <AuthenticatedManagerApp />
  )
}

function AuthenticatedManagerApp() {
  const client = useQueryClient()
  const location = useManagerLocation()
  const session = useQuery({
    queryKey: sessionKey,
    queryFn: ({ signal }) => fetchManager(signal),
  })
  const [login, setLogin] = useState<LoginState>({ kind: 'idle' })
  const expire = useCallback(() => {
    clearSession(client)
    client.setQueryData(sessionKey, null)
    setLogin({ kind: 'idle' })
  }, [client])
  const checkGrants = useCallback(() => {
    void client.invalidateQueries({ queryKey: sessionKey })
  }, [client])
  const logout = useMutation({
    mutationFn: logoutManager,
    onSuccess: expire,
  })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (login.kind === 'pending') return
    const form = event.currentTarget
    const fields = new FormData(form)
    const email = fields.get('email')
    const password = fields.get('password')
    if (typeof email !== 'string' || typeof password !== 'string') return
    const passwordInput = form.querySelector<HTMLInputElement>('[name="password"]')
    if (passwordInput) passwordInput.value = ''
    setLogin({ kind: 'pending' })
    try {
      const manager = await loginManager({ email, password })
      clearSession(client)
      client.setQueryData(sessionKey, manager)
      setLogin({ kind: 'idle' })
    } catch (error) {
      setLogin({ kind: 'failed', message: loginErrorMessage(error) })
    }
  }

  if (session.isSuccess && session.data) {
    const manager = session.data
    const scope = JSON.stringify([manager.id, manager.grants.slice().sort()])
    const section = workspaceSection(location.search)
    const clients = section === 'clients'
    const widgets = section === 'widgets'
    const feed = section === 'feed'
    const selected = getAccountLocation(location.search)
    const canRead = manager.grants.includes('clients.read')
    return (
      <Workspace
        {...location}
        name={manager.name}
        accountSelected={selected !== null}
        onLogout={() => logout.mutate()}
        logoutPending={logout.isPending}
        logoutFailed={logout.isError}
      >
        <AccountCommands key={scope}>
          {section === 'staff' ? (
            <StaffPage
              key={scope}
              {...location}
              scope={scope}
              grants={manager.grants}
              managerId={manager.id}
              onExpired={expire}
              onForbidden={checkGrants}
            />
          ) : feed && !selected ? (
            <Timeline
              key={scope}
              {...location}
              context={{ kind: 'feed' }}
              scope={scope}
              grants={manager.grants}
              onExpired={expire}
              onForbidden={checkGrants}
            />
          ) : widgets ? (
            <WidgetsPage
              key={scope}
              {...location}
              scope={scope}
              grants={manager.grants}
              onExpired={expire}
              onForbidden={checkGrants}
            />
          ) : !canRead ? (
            <>
              <h1>{clients ? 'Клиенты' : 'Установки'}</h1>
              <p role="alert">
                {clients || selected ? 'Нет доступа к клиентам.' : 'Нет доступа к установкам.'}
              </p>
            </>
          ) : selected ? (
            <ManagerAccountCard
              key={selected.id}
              {...location}
              selected={selected}
              scope={scope}
              grants={manager.grants}
              onExpired={expire}
              onForbidden={checkGrants}
            />
          ) : clients ? (
            <ClientsPage {...location} scope={scope} onExpired={expire} onForbidden={checkGrants} />
          ) : (
            <InstallationsPage
              {...location}
              scope={scope}
              canWrite={manager.grants.includes('clients.write')}
              onExpired={expire}
              onForbidden={checkGrants}
            />
          )}
        </AccountCommands>
      </Workspace>
    )
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="manager-heading">
        <div className={styles.brand}>
          <BrandLogo />
          <span>Ракурс</span>
        </div>
        <h1 id="manager-heading">Кабинет менеджеров</h1>
        {session.isPending ? (
          <p role="status">Проверяем вход…</p>
        ) : session.isError ? (
          <>
            <p role="alert">Не удалось проверить вход.</p>
            <button type="button" onClick={() => void session.refetch()}>
              Повторить
            </button>
          </>
        ) : (
          <form
            className={styles.form}
            onSubmit={(event) => void submit(event)}
            aria-busy={login.kind === 'pending'}
          >
            <label>
              Email
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <label>
              Пароль
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            {login.kind === 'failed' ? <p role="alert">{login.message}</p> : null}
            <button type="submit" disabled={login.kind === 'pending'}>
              {login.kind === 'pending' ? 'Выполняется вход…' : 'Войти'}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
