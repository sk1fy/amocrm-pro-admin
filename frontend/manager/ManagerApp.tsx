import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, type FormEvent } from 'react'
import { clearSession } from '../src/app/session'
import { BrandLogo } from '../src/components/BrandLogo'
import { loginErrorMessage } from '../src/states/login'
import { ManagerAccountCard } from './AccountCard'
import { AccountCommands } from './accountCommands'
import { AccountsPage } from './AccountsPage'
import { getAccountLocation, listSearch, ManagerLink } from './accountsLocation'
import { WidgetsPage } from './WidgetsPage'
import { InstallationsPage } from './InstallationsPage'
import { useManagerLocation } from './installationsLocation'
import { fetchManager, loginManager, logoutManager } from './session'
import styles from './ManagerApp.module.css'

const sessionKey = ['managers', 'me']

type LoginState = { kind: 'idle' } | { kind: 'pending' } | { kind: 'failed'; message: string }

export function ManagerApp() {
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
    const params = new URLSearchParams(location.search)
    const section = params.get('section')
    const installations = section === null || section === 'installations'
    const clients = section === 'clients'
    const widgets = section === 'widgets'
    const selected = getAccountLocation(location.search)
    const canRead = manager.grants.includes('clients.read')
    return (
      <>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <div className={styles.brand}>
              <BrandLogo />
              <span>Ракурс</span>
            </div>
            <nav aria-label="Кабинет менеджеров">
              <ManagerLink
                search={listSearch(location.search, 'installations')}
                navigate={location.navigate}
                current={installations}
              >
                Установки
              </ManagerLink>
              <ManagerLink
                search={listSearch(location.search, 'clients')}
                navigate={location.navigate}
                current={clients}
              >
                Клиенты
              </ManagerLink>
              <ManagerLink
                search={listSearch(location.search, 'widgets')}
                navigate={location.navigate}
                current={widgets}
              >
                Виджеты
              </ManagerLink>
            </nav>
            <div className={styles.identity}>
              <span>{manager.name}</span>
              <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
                Выйти
              </button>
            </div>
          </div>
        </header>
        <main className={styles.workspace}>
          {logout.isError ? <p role="alert">Не удалось выйти. Повторите попытку.</p> : null}
          {logout.isPending ? <p role="status">Завершаем сеанс…</p> : null}
          <div hidden={logout.isPending}>
            <AccountCommands key={scope}>
              {widgets ? (
                <WidgetsPage
                  key={scope}
                  {...location}
                  scope={scope}
                  grants={manager.grants}
                  onExpired={expire}
                  onForbidden={checkGrants}
                />
              ) : !installations && !clients ? (
                <>
                  <h1>{section === 'staff' ? 'Сотрудники' : 'Кабинет менеджеров'}</h1>
                  <p>Раздел пока недоступен.</p>
                </>
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
                <AccountsPage
                  {...location}
                  scope={scope}
                  onExpired={expire}
                  onForbidden={checkGrants}
                />
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
          </div>
        </main>
      </>
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
