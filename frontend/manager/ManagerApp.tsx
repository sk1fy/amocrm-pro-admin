import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { clearSession } from '../src/app/session'
import { BrandLogo } from '../src/components/BrandLogo'
import { loginErrorMessage } from '../src/states/login'
import { fetchManager, loginManager, logoutManager } from './session'
import styles from './ManagerApp.module.css'

const sessionKey = ['managers', 'me']

type LoginState = { kind: 'idle' } | { kind: 'pending' } | { kind: 'failed'; message: string }

export function ManagerApp() {
  const client = useQueryClient()
  const session = useQuery({
    queryKey: sessionKey,
    queryFn: ({ signal }) => fetchManager(signal),
  })
  const [login, setLogin] = useState<LoginState>({ kind: 'idle' })
  const logout = useMutation({
    mutationFn: logoutManager,
    onSuccess() {
      clearSession(client)
      client.setQueryData(sessionKey, null)
      setLogin({ kind: 'idle' })
    },
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
        ) : session.data ? (
          <>
            <p>{session.data.name}</p>
            {logout.isError ? <p role="alert">Не удалось выйти. Повторите попытку.</p> : null}
            <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
              Выйти
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
