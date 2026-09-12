import type { ReactNode } from 'react'
import { Link, Outlet, useRouter, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMe, keys, logout } from '../api/queries'
import styles from './layout.module.css'

const nav = [
  { to: '/', label: 'Обзор' },
  { to: '/accounts', label: 'Аккаунты' },
  { to: '/widgets', label: 'Виджеты' },
  { to: '/operations', label: 'Операции' },
  { to: '/system', label: 'Система' },
] as const

export function AppLayout() {
  const meQuery = useQuery({ queryKey: keys.me, queryFn: fetchMe })
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const me = meQuery.data

  async function onLogout() {
    await logout()
    queryClient.clear()
    router.history.push('/login?next=/')
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Link to="/" className={styles.logo}>
            Ракурс
          </Link>
          <nav className={styles.nav} aria-label="Разделы">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                aria-current={
                  item.to === '/'
                    ? pathname === '/'
                      ? 'page'
                      : undefined
                    : pathname === item.to || pathname.startsWith(`${item.to}/`)
                      ? 'page'
                      : undefined
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className={styles.user}>
          <span>{me?.email}</span>
          <button type="button" onClick={() => void onLogout()}>
            Выйти
          </button>
        </div>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}

export function LoginShell({ children }: { children: ReactNode }) {
  return <div className={styles.login}>{children}</div>
}
