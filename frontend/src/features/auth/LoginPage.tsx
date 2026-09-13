import { useState, type FormEvent } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useRouteSearch } from '../../app/hooks'
import { useQueryClient } from '@tanstack/react-query'
import { isApiError } from '../../api/client'
import { keys, login } from '../../api/queries'
import { safeNextPath } from '../../lib/format'
import { LoginShell } from '../../app/layout'
import { clearSession } from '../../app/session'
import styles from './LoginPage.module.css'

export function LoginPage() {
  const { next } = useRouteSearch<{ next?: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const me = await login(email, password)
      clearSession(queryClient)
      queryClient.setQueryData(keys.me, me)
      router.history.push(safeNextPath(next))
    } catch (caught) {
      if (isApiError(caught) && caught.status === 429) {
        setError('Слишком много попыток, повторите через 60 с')
      } else {
        setError('Неверный email или пароль')
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <LoginShell>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true" />
          <div>
            <div className={styles.brandName}>Ракурс</div>
            <div className={styles.brandCaption}>панель управления</div>
          </div>
        </div>
        <form
          className={styles.card}
          onSubmit={(event) => void onSubmit(event)}
          data-testid="login-form"
        >
          <h1>Вход в Ракурс</h1>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <label className={styles.field}>
            <span>Email</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Пароль</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="submit" disabled={pending}>
            Войти
          </button>
        </form>
      </div>
    </LoginShell>
  )
}
