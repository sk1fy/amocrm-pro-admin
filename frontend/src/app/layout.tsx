import { useEffect, useState, type ReactNode } from 'react'
import { Link, Outlet, useRouter, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMe, keys, logout } from '../api/queries'
import type { Me } from '../api/types'
import { employeeRoleLabels } from '../states'
import { breadcrumbsFor } from './crumbs'
import { clearSession } from './session'
import { BrandLogo } from '../components/BrandLogo'
import styles from './layout.module.css'

type NavIconName = 'overview' | 'accounts' | 'widgets' | 'operations' | 'system'

const navItems: Array<{ to: string; label: string; icon: NavIconName }> = [
  { to: '/', label: 'Обзор', icon: 'overview' },
  { to: '/accounts', label: 'Аккаунты', icon: 'accounts' },
  { to: '/widgets', label: 'Виджеты', icon: 'widgets' },
  { to: '/operations', label: 'Операции', icon: 'operations' },
  { to: '/system', label: 'Система', icon: 'system' },
]

function NavIcon({ name }: { name: NavIconName }) {
  const props = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    'aria-hidden': true,
  } as const
  switch (name) {
    case 'overview':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      )
    case 'accounts':
      return (
        <svg {...props}>
          <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
          <path d="M16 9h2a2 2 0 0 1 2 2v10" />
          <path d="M8 7h2M8 11h2M8 15h2M2 21h20" />
        </svg>
      )
    case 'widgets':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="8" height="8" rx="1.5" />
          <rect x="13" y="3" width="8" height="8" rx="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" />
          <path d="M17 13v8M13 17h8" />
        </svg>
      )
    case 'operations':
      return (
        <svg {...props}>
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      )
    case 'system':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 13.5a1.7 1.7 0 0 0 0 3l.5.3-1 1.8-.6-.2a1.7 1.7 0 0 0-2.3 1.4l-.1.6h-2l-.1-.6a1.7 1.7 0 0 0-2.3-1.4l-.6.2-1-1.8.5-.3a1.7 1.7 0 0 0 0-3l-.5-.3 1-1.8.6.2a1.7 1.7 0 0 0 2.3-1.4l.1-.6h2l.1.6a1.7 1.7 0 0 0 2.3 1.4l.6-.2 1 1.8-.5.3z" />
        </svg>
      )
  }
}

function initials(me: Me | undefined): string {
  const source = me?.name?.trim() || me?.email || ''
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  const value = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
  return value || 'А'
}

export function AppLayout() {
  const meQuery = useQuery({ queryKey: keys.me, queryFn: fetchMe })
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [menuOpen, setMenuOpen] = useState(false)
  const me = meQuery.data

  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  async function onLogout() {
    await logout()
    clearSession(queryClient)
    router.history.push('/login?next=/')
  }

  const crumbs = breadcrumbsFor(pathname)

  return (
    <div className={menuOpen ? `${styles.shell} ${styles.menuOpen}` : styles.shell}>
      <header className={styles.topbar}>
        <button
          className={styles.menuBtn}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Меню"
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            aria-hidden="true"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className={styles.brand}>
          <BrandLogo className={styles.brandMark} />
          <span>Ракурс</span>
          <span className={styles.brandTitle}>Сервер виджетов</span>
        </div>
        <div className={styles.profile}>
          <div className={styles.avatar} aria-hidden="true">
            {initials(me)}
          </div>
          <div className={styles.who}>
            <div className={styles.whoName}>{me?.name ?? me?.email ?? '—'}</div>
            <div className={styles.whoRole}>
              {me ? (employeeRoleLabels[me.role] ?? me.role) : 'загрузка…'}
            </div>
          </div>
          <button
            className={styles.logout}
            type="button"
            onClick={() => void onLogout()}
            aria-label="Выйти"
            title="Выйти"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              aria-hidden="true"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </button>
        </div>
      </header>
      <aside id="app-sidebar" className={styles.sidebar}>
        <nav className={styles.nav} aria-label="Разделы">
          {navItems.map((item) => (
            <Link
              key={item.to}
              title={item.label}
              to={item.to}
              aria-current={
                pathname === item.to || pathname.startsWith(`${item.to}/`) ? 'page' : undefined
              }
            >
              <NavIcon name={item.icon} />
              <span className={styles.navText}>{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>
      <div className={styles.backdrop} onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <div className={styles.main}>
        <main className={styles.content}>
          {crumbs.length > 2 ? (
            <nav className={styles.crumbs} aria-label="Хлебные крошки">
              {crumbs.map((crumb, index) => (
                <span key={`${crumb.href ?? crumb.label}-${index}`} className={styles.crumb}>
                  {index > 0 ? <span aria-hidden="true">›</span> : null}
                  {crumb.href ? (
                    <Link to={crumb.href} className={crumb.mono ? styles.crumbMono : undefined}>
                      {crumb.label}
                    </Link>
                  ) : (
                    <span
                      aria-current="page"
                      className={
                        crumb.mono
                          ? `${styles.crumbCurrent} ${styles.crumbMono}`
                          : styles.crumbCurrent
                      }
                    >
                      {crumb.label}
                    </span>
                  )}
                </span>
              ))}
            </nav>
          ) : null}
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export function LoginShell({ children }: { children: ReactNode }) {
  return <div className={styles.login}>{children}</div>
}
