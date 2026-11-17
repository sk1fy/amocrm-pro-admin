import { useState, type FormEvent } from 'react'
import { isApiError } from '../src/api/client'
import { acceptInvitation, type InvitationAcceptance } from './staffApi'
import { createRequestKey } from '../src/features/operations/intents'
import styles from './ManagerApp.module.css'

export function captureInvitation(): string | null {
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  if (!fragment.has('invitation')) return null
  const token = fragment.get('invitation') ?? ''
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search,
  )
  return token
}

export function AcceptInvitationPage({
  token,
  onAccepted,
}: {
  token: string
  onAccepted: () => void
}) {
  const [state, setState] = useState<'idle' | 'pending' | 'done' | 'failed' | 'unknown'>('idle')
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState<InvitationAcceptance | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const password = String(values.get('password') ?? '')
    if (password !== values.get('confirmation')) {
      setMessage('Пароли не совпадают.')
      return
    }
    const command = { token, password, key: createRequestKey() }
    setAttempt(command)
    await execute(command)
    if (form.isConnected) form.reset()
  }
  async function execute(command: InvitationAcceptance) {
    setState('pending')
    setMessage('')
    try {
      await acceptInvitation(command)
      setAttempt(null)
      setState('done')
    } catch (error) {
      setState(isApiError(error) && error.status < 500 ? 'failed' : 'unknown')
      setMessage(
        isApiError(error) && error.status < 500
          ? 'Приглашение недействительно или истекло. Обратитесь к администратору.'
          : 'Результат неизвестен. Повторите прежнюю команду: она использует тот же пароль и ключ.',
      )
    }
  }
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1>Приглашение в кабинет менеджеров</h1>
        {state === 'done' ? (
          <>
            <p role="status">Пароль установлен. Теперь войдите с email и паролем.</p>
            <button type="button" onClick={onAccepted}>
              Перейти ко входу
            </button>
          </>
        ) : (
          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            <p>Создайте пароль для менеджерского доступа.</p>
            <label>
              Новый пароль
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                disabled={state === 'pending' || state === 'unknown'}
              />
            </label>
            <label>
              Повторите пароль
              <input
                name="confirmation"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                disabled={state === 'pending' || state === 'unknown'}
              />
            </label>
            {message ? <p role="alert">{message}</p> : null}
            {state === 'unknown' && attempt ? (
              <button type="button" onClick={() => void execute(attempt)}>
                Повторить прежнюю команду
              </button>
            ) : null}
            <button disabled={state === 'pending' || state === 'unknown' || !token}>
              {state === 'pending' ? 'Устанавливаем пароль…' : 'Установить пароль'}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
