import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { BrandLogo } from '../src/components/BrandLogo'
import styles from '../src/features/auth/LoginPage.module.css'
import chooser from './chooser.module.css'

type Workspace = 'core-admin' | 'managers' | 'partners'

export function DemoLoginPage() {
  const [workspace, setWorkspace] = useState<Workspace>('core-admin')
  const [error, setError] = useState('')

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('Рабочий вход недоступен в демо. Выберите кабинет менеджеров или партнёров.')
  }

  return (
    <main className={styles.page}>
      <section className={styles.poster} aria-label="Ракурс, демонстрация">
        <div className={styles.brand}>
          <BrandLogo />
          <span>Ракурс</span>
        </div>
        <div className={styles.posterCopy}>
          <span className={styles.eyebrow}>Демо-данные</span>
          <p className={styles.statement}>Выберите кабинет.</p>
          <p className={styles.description}>Изменения сохраняются только в этом браузере.</p>
        </div>
      </section>
      <section className={styles.entry} aria-labelledby="login-heading">
        <div className={styles.formWrap}>
          <h1 id="login-heading">Демонстрация Ракурс</h1>
          <fieldset className={chooser.workspace}>
            <legend>Выберите кабинет</legend>
            <div className={chooser.workspaceChoices}>
              {(['core-admin', 'managers', 'partners'] as const).map((item) => (
                <label key={item}>
                  <input
                    type="radio"
                    name="workspace"
                    value={item}
                    checked={workspace === item}
                    onChange={() => setWorkspace(item)}
                  />
                  {item}
                </label>
              ))}
            </div>
          </fieldset>
          {workspace === 'managers' ? (
            <Link
              to="/managers"
              search={{ section: 'installs', client: undefined }}
              className={chooser.demoLink}
            >
              Открыть демо для менеджеров
            </Link>
          ) : workspace === 'partners' ? (
            <Link
              to="/managers"
              search={{ section: 'partners', client: undefined, mode: 'partner' }}
              className={chooser.demoLink}
            >
              Открыть демо для партнёров
            </Link>
          ) : (
            <form className={styles.form} onSubmit={onSubmit} data-testid="login-form">
              <p className={styles.intro}>Рабочие учётные данные здесь не используются.</p>
              {error ? <p role="alert">{error}</p> : null}
              <label className={styles.field}>
                <span>Email</span>
                <input name="email" type="email" required autoComplete="off" />
              </label>
              <label className={styles.field}>
                <span>Пароль</span>
                <input name="password" type="password" required autoComplete="off" />
              </label>
              <button type="submit" className={styles.submit}>
                Войти
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  )
}
