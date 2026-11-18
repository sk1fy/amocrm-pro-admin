import { useState, type FormEvent } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useRouteSearch } from '../../app/hooks'
import { useQueryClient } from '@tanstack/react-query'
import { loginErrorMessage } from '../../states/login'
import { keys, login } from '../../api/queries'
import { safeNextPath } from '../../lib/format'
import { clearSession } from '../../app/session'
import { BrandLogo } from '../../components/BrandLogo'
import styles from './LoginPage.module.css'

export function LoginPage() {
  const { next } = useRouteSearch<{ next?: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setError(null)
    setPending(true)
    try {
      const me = await login(email, password)
      clearSession(queryClient)
      queryClient.setQueryData(keys.me, me)
      router.history.push(safeNextPath(next))
    } catch (caught) {
      setError(loginErrorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.poster} aria-label="Ракурс — панель управления">
        <div className={styles.brand}>
          <BrandLogo />
          <span>Ракурс</span>
        </div>
        <div className={styles.art} aria-hidden="true">
          <span className={styles.orbit} />
          <span className={styles.frameOuter} />
          <span className={styles.frameMiddle} />
          <span className={styles.frameInner} />
          <span className={styles.aperture} />
          <span className={styles.artLine} />
        </div>
        <div className={styles.posterCopy}>
          <span className={styles.eyebrow}>Панель управления</span>
          <p className={styles.statement}>
            Всё в своём
            <br />
            ракурсе.
          </p>
          <p className={styles.description}>
            Аккаунты, виджеты и события —<br />
            единое пространство для вашей работы.
          </p>
        </div>
        <span className={styles.posterFoot} aria-hidden="true">
          Ракурс / рабочее пространство
        </span>
      </section>
      <section className={styles.entry} aria-labelledby="login-heading">
        <div className={styles.entryCaption}>Для команды Ракурс</div>
        <div className={styles.formWrap}>
          <div className={styles.welcomeMark} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M13 4h6v16h-6M3 12h12m-4-4 4 4-4 4" />
            </svg>
          </div>
          <h1 id="login-heading">С возвращением</h1>
          <p className={styles.intro}>Войдите, чтобы продолжить работу.</p>
          <form
            className={styles.form}
            onSubmit={(event) => void onSubmit(event)}
            data-testid="login-form"
            aria-busy={pending}
          >
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
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Ваш email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <div className={styles.field}>
              <label htmlFor="login-password">Пароль</label>
              <div className={styles.passwordWrap}>
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Введите пароль"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className={styles.passwordToggle}
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    aria-hidden="true"
                  >
                    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="2.5" />
                    {showPassword ? <path d="m4 3 16 18" /> : null}
                  </svg>
                </button>
              </div>
            </div>
            <button type="submit" className={styles.submit} disabled={pending}>
              Войти
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <path d="M4 12h15m-6-6 6 6-6 6" />
              </svg>
            </button>
            <div className={styles.progress} role="status">
              {pending ? 'Выполняется вход…' : ''}
            </div>
          </form>
          <p className={styles.help}>Нет доступа? Обратитесь к администратору вашей команды.</p>
        </div>
        <div className={styles.entryFoot}>Вход для сотрудников</div>
      </section>
    </main>
  )
}
