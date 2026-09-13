import { useEffect, useState, type ReactNode } from 'react'
import { Link, Outlet, useRouter, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMe, keys, logout } from '../api/queries'
import type { Me } from '../api/types'
import { employeeRoleLabels } from '../states'
import { clearSession } from './session'
import styles from './layout.module.css'

type NavIconName = 'overview' | 'accounts' | 'widgets' | 'operations' | 'system'

const navGroups: Array<{
  label: string
  items: Array<{ to: string; label: string; icon: NavIconName }>
}> = [
  {
    label: 'Панель',
    items: [{ to: '/', label: 'Обзор', icon: 'overview' }],
  },
  {
    label: 'Управление',
    items: [
      { to: '/accounts', label: 'Аккаунты', icon: 'accounts' },
      { to: '/widgets', label: 'Виджеты', icon: 'widgets' },
      { to: '/operations', label: 'Операции', icon: 'operations' },
    ],
  },
  {
    label: 'Система',
    items: [{ to: '/system', label: 'Система', icon: 'system' }],
  },
]

const crumbLabels: Record<string, string> = {
  accounts: 'Аккаунты',
  widgets: 'Виджеты',
  operations: 'Операции',
  system: 'Система',
  employees: 'Сотрудники',
  sessions: 'Сессии',
  audit: 'Аудит',
}

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

  const segments = pathname.split('/').filter(Boolean)
  const crumbs =
    segments.length === 0
      ? [{ label: 'Обзор', mono: false }]
      : segments.map((segment) => ({
          label: crumbLabels[segment] ?? segment,
          mono: !(segment in crumbLabels),
        }))

  return (
    <div className={styles.shell}>
      <aside className={menuOpen ? `${styles.sidebar} ${styles.sidebarOpen}` : styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark} aria-hidden="true" />
          <div>
            <div className={styles.brandName}>Ракурс</div>
            <div className={styles.brandEnv}>панель управления</div>
          </div>
        </div>
        <nav className={styles.nav} aria-label="Разделы">
          {navGroups.map((group) => (
            <div key={group.label} className={styles.navGroup}>
              <div className={styles.navLabel}>{group.label}</div>
              {group.items.map((item) => (
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
                  <NavIcon name={item.icon} />
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className={styles.sidebarFoot}>
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
      </aside>
      <div
        className={menuOpen ? `${styles.backdrop} ${styles.backdropShow}` : styles.backdrop}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button
              className={styles.menuBtn}
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Меню"
              aria-expanded={menuOpen}
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
            <nav className={styles.crumbs} aria-label="Хлебные крошки">
              {crumbs.map((crumb, index) => (
                <span key={`${crumb.label}-${index}`} className={styles.crumb}>
                  {index > 0 ? (
                    <span className={styles.crumbSep} aria-hidden="true">
                      /
                    </span>
                  ) : null}
                  {index === crumbs.length - 1 ? (
                    <b className={crumb.mono ? styles.crumbMono : undefined}>{crumb.label}</b>
                  ) : (
                    <span className={crumb.mono ? styles.crumbMono : undefined}>{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
          </div>
        </header>
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export function LoginShell({ children }: { children: ReactNode }) {
  return <div className={styles.login}>{children}</div>
}
