import { useRef, useState, type ReactNode } from 'react'
import { BrandLogo } from '../src/components/BrandLogo'
import shell from '../src/components/ManagerWorkspace.module.css'
import { listSearch, ManagerLink } from './accountsLocation'
import styles from './ManagerApp.module.css'

const sections = [
  {
    key: 'installations',
    title: 'Установки',
    hint: 'Новые и проверенные, карточки аккаунтов',
    icon: 'M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4',
  },
  {
    key: 'clients',
    title: 'Клиенты',
    hint: 'Аккаунты amoCRM',
    icon: 'M16 20v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m16 0v-2a4 4 0 0 0-3-4M14 4a4 4 0 0 1 0 8M14 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  },
  {
    key: 'companies',
    title: 'Компании',
    hint: 'Компании и контакты в rakurscrm',
    icon: 'M3 21h18M5 21V4h10v17m0-11h4v11M9 8h2M9 12h2M9 16h2',
  },
  {
    key: 'widgets',
    title: 'Виджеты',
    hint: 'Каталог, установки и настройки',
    icon: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z',
  },
  {
    key: 'feed',
    title: 'Лента событий',
    hint: 'События по аккаунтам и виджетам',
    icon: 'M4 6h16M4 12h16M4 18h10',
  },
  {
    key: 'staff',
    title: 'Сотрудники',
    hint: 'Люди и доступ по разделам',
    icon: 'M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2m-3-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  },
] as const

export function workspaceSection(search: string) {
  const params = new URLSearchParams(search)
  const value = params.get('section')
  if (value === 'clients' && (params.get('clients_tab') === 'companies' || params.has('company')))
    return 'companies'
  return sections.find(({ key }) => key === value)?.key ?? 'installations'
}

function sectionSearch(search: string, section: (typeof sections)[number]['key']) {
  const params = new URLSearchParams(listSearch(search, section))
  params.delete('clients_tab')
  params.delete('company')
  return params.toString()
}

export function Workspace({
  search,
  navigate,
  name,
  onLogout,
  logoutPending,
  logoutFailed,
  children,
}: {
  search: string
  navigate: (search: string) => void
  name: string
  onLogout: () => void
  logoutPending: boolean
  logoutFailed: boolean
  children: ReactNode
}) {
  const section = workspaceSection(search)
  const [menuOpen, setMenuOpen] = useState(() => window.innerWidth >= 1100)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)

  function select(search: string) {
    navigate(search)
    if (mobileMenuOpen) {
      setMobileMenuOpen(false)
      menuButton.current?.focus()
    }
  }

  return (
    <div
      className={shell.shell}
      data-overview="true"
      data-menu-open={menuOpen}
      data-mobile-open={mobileMenuOpen}
    >
      <header className={shell.topbar}>
        <button
          type="button"
          ref={menuButton}
          className={shell.mobileMenuButton}
          aria-controls="manager-nav"
          aria-expanded={mobileMenuOpen}
          aria-label="Меню"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          ☰
        </button>
        <span className={shell.brand}>
          <BrandLogo /> Ракурс
        </span>
        <span className={shell.product}>Сервер виджетов</span>
        <div className={shell.profile + ' ' + styles.employee}>
          <span>{name}</span>
          {import.meta.env.BASE_URL === '/managers/' ? <a href="/login">Сменить кабинет</a> : null}
          <button type="button" onClick={onLogout} disabled={logoutPending}>
            Выйти
          </button>
        </div>
      </header>
      <aside id="manager-nav" className={shell.sidebar}>
        <button
          type="button"
          className={shell.menuButton}
          aria-controls="manager-sections"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Свернуть меню' : 'Развернуть меню'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">{menuOpen ? '‹' : '›'}</span>
          {menuOpen ? 'Свернуть меню' : null}
        </button>
        <nav id="manager-sections" className={shell.menu} aria-label="Кабинет менеджеров">
          {sections.map(({ key, title, hint, icon }) => (
            <ManagerLink
              key={key}
              search={sectionSearch(search, key)}
              navigate={select}
              current={section === key}
              label={title}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <path d={icon} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className={shell.menuLabel}>
                {title}
                <small>{hint}</small>
              </span>
            </ManagerLink>
          ))}
        </nav>
      </aside>
      <main className={shell.main}>
        {logoutFailed ? <p role="alert">Не удалось выйти. Повторите попытку.</p> : null}
        {logoutPending ? <p role="status">Завершаем сеанс…</p> : null}
        <div className={styles.content} hidden={logoutPending}>
          {children}
        </div>
      </main>
    </div>
  )
}
