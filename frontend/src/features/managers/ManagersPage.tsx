import { useRef, useState } from 'react'
import { Link, useSearch } from '@tanstack/react-router'
import { BrandLogo } from '../../components/BrandLogo'
import { DataTable, type DataTableColumn } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { boards, clients, installs, type DemoRow } from './fixtures'
import { AccountProfile } from './AccountProfile'
import { CellValue } from './CellValue'
import { sections, type Section } from './sections'
import styles from './ManagersPage.module.css'

const sectionKeys = Object.keys(sections) as Section[]

const icons = {
  download: 'M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4',
  clients:
    'M16 20v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m16 0v-2a4 4 0 0 0-3-4M14 4a4 4 0 0 1 0 8M14 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  grid: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z',
  bag: 'M5 9h14l1 11H4L5 9Zm4 0V7a3 3 0 0 1 6 0v2',
  case: 'M3 8h18v12H3zM8 8V4h8v4m-13 5h18',
  file: 'M6 3h8l4 4v14H6zm7 0v5h5M9 12h6m-6 4h6',
  money: 'M5 9h14v10H5zm3 0V5h8v4m-7 5h6',
  chart: 'M4 20h16M6 16v-4m6 4V6m6 10V9',
  feed: 'M4 6h16M4 12h16M4 18h10',
  person: 'M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2m-3-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
}

const clientColumns: Partial<Record<Section, number>> = {
  installs: 2,
  clients: 0,
  invoices: 1,
  payments: 1,
  feed: 2,
}

function matches(row: DemoRow, query: string) {
  const term = query.trim().toLocaleLowerCase('ru')
  const text = row.cells
    .map((cell) =>
      typeof cell === 'string'
        ? cell
        : `${cell.text} ${cell.note ?? ''} ${cell.line ?? ''} ${cell.tags?.join(' ') ?? ''}`,
    )
    .join(' ')
    .toLocaleLowerCase('ru')
  const phone = typeof row.cells[4] === 'object' ? row.cells[4].text.replace(/\D/g, '') : ''
  const digits = term.replace(/\D/g, '')
  return (
    !term ||
    text.includes(term) ||
    (digits.length >= 3 && /^[+()\d\s-]+$/.test(term) && phone.includes(digits))
  )
}

export function ManagersPage() {
  const { section, client } = useSearch({ from: '/managers' })
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [menuOpen, setMenuOpen] = useState(() => window.innerWidth >= 1440)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const customer = clients.find((item) => item.id === client)
  const rows = installs.map((item) =>
    item.id in checked
      ? { ...item, group: checked[item.id] ? 'Проверенные' : 'Непроверенные' }
      : item,
  )
  const uncheckedCount = rows.filter((item) => item.group === 'Непроверенные').length

  return (
    <div className={styles.shell} data-menu-open={menuOpen} data-mobile-open={mobileMenuOpen}>
      <header className={styles.topbar}>
        <button
          type="button"
          ref={menuButton}
          className={styles.mobileMenuButton}
          aria-controls="manager-nav"
          aria-expanded={mobileMenuOpen}
          aria-label="Меню"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          ☰
        </button>
        <span className={styles.brand}>
          <BrandLogo /> Ракурс
        </span>
        <span className={styles.product}>Сервер виджетов</span>
        <div className={styles.profile}>
          <span>Менеджер · демо</span>
          <Link to="/login" search={{ next: undefined }}>
            Сменить кабинет
          </Link>
        </div>
      </header>
      <aside id="manager-nav" className={styles.sidebar}>
        <button
          type="button"
          className={styles.menuButton}
          aria-controls="manager-nav"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Свернуть меню' : 'Развернуть меню'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">{menuOpen ? '‹' : '›'}</span>
          {menuOpen ? 'Свернуть меню' : null}
        </button>
        <nav className={styles.menu} aria-label="Разделы менеджеров">
          {sectionKeys.map((key) => {
            const item = sections[key]
            const count =
              key === 'installs'
                ? uncheckedCount
                : key === 'invoices'
                  ? boards.invoices.rows.filter((row) => row.group === 'Без движения').length
                  : 0
            return (
              <Link
                key={key}
                to="/managers"
                search={{ section: key, client: undefined }}
                aria-current={section === key ? 'page' : undefined}
                aria-label={item.title}
                title={item.title}
                onClick={() => {
                  if (window.innerWidth <= 760) {
                    menuButton.current?.focus()
                    setMobileMenuOpen(false)
                  }
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <path d={icons[item.icon]} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className={styles.menuLabel}>
                  {item.title}
                  <small>{item.hint}</small>
                </span>
                {count > 0 ? (
                  <span className={styles.menuCount} aria-hidden="true">
                    {count}
                  </span>
                ) : null}
              </Link>
            )
          })}
        </nav>
      </aside>
      <main className={styles.main}>
        <div className={styles.demo}>Демо-данные. Изменения действуют до обновления страницы.</div>
        {customer ? (
          <AccountProfile
            key={customer.id}
            client={customer}
            section={section}
            rows={rows}
            check={(id, value) => setChecked((previous) => ({ ...previous, [id]: value }))}
          />
        ) : client ? (
          <EmptyState
            title="Клиент не найден"
            action={
              <Link to="/managers" search={{ section, client: undefined }}>
                Вернуться к списку
              </Link>
            }
          />
        ) : (
          <BoardView
            key={section}
            section={section}
            rows={section === 'installs' ? rows : boards[section].rows}
            check={(id, value) => setChecked((previous) => ({ ...previous, [id]: value }))}
          />
        )}
      </main>
    </div>
  )
}

function BoardView({
  section,
  rows,
  check,
}: {
  section: Section
  rows: readonly DemoRow[]
  check: (id: string, checked: boolean) => void
}) {
  const board = boards[section]
  const [group, setGroup] = useState(board.filters?.[0] ?? '')
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [tariff, setTariff] = useState('')
  const candidates = rows.filter(
    (row) =>
      matches(row, query) &&
      (!from || (row.date ?? '') >= from) &&
      (!to || (row.date ?? '') <= to) &&
      (!tariff || row.cells[3] === tariff),
  )
  const showAll = !group || group === 'Все' || group === 'Все виджеты'
  const visible = candidates.filter((row) => showAll || row.group === group)
  const columns: DataTableColumn<DemoRow>[] = board.columns.map((header, index) => ({
    id: header,
    header,
    cell: (row) => (
      <>
        {row.client &&
        (clientColumns[section] === index ||
          (section === 'installs' && index === 3) ||
          (section === 'clients' && index === 1)) ? (
          <Link className={styles.rowLink} to="/managers" search={{ section, client: row.client }}>
            <CellValue value={row.cells[index]} />
          </Link>
        ) : (
          <CellValue value={row.cells[index]} />
        )}
      </>
    ),
  }))
  if (section === 'installs') {
    columns.push({
      id: 'check',
      header: 'Проверка',
      cell: (row) => (
        <button
          type="button"
          className={styles.rowAction}
          data-checked={row.group === 'Проверенные'}
          onClick={() => check(row.id, row.group !== 'Проверенные')}
        >
          {row.group === 'Проверенные' ? (
            'Вернуть'
          ) : (
            <>
              <span aria-hidden="true">✓</span> Проверен
            </>
          )}
        </button>
      ),
    })
  }

  return (
    <>
      <header>
        <h1>{sections[section].title}</h1>
        <p className={styles.description}>{board.description}</p>
      </header>
      {section === 'stats' ? <Statistics /> : null}
      <div className={section === 'installs' ? styles.installControls : styles.controls}>
        {board.filters ? (
          <div
            className={section === 'clients' ? styles.summary : styles.tabs}
            aria-label="Фильтр по состоянию"
            role="group"
          >
            {board.filters.map((filter) => (
              <button
                key={filter}
                type="button"
                aria-pressed={group === filter}
                onClick={() => setGroup(filter)}
              >
                {filter}
                <span className={styles.count}>
                  {
                    candidates.filter(
                      (row) => filter === 'Все' || filter === 'Все виджеты' || row.group === filter,
                    ).length
                  }
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div className={styles.filters}>
          {board.dateLabel ? (
            <>
              <label>
                {board.dateLabel} с{' '}
                <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              </label>
              <label>
                по <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
              </label>
            </>
          ) : null}
          {section === 'clients' ? (
            <label>
              Тариф
              <select value={tariff} onChange={(event) => setTariff(event.target.value)}>
                <option value="">Все тарифы</option>
                {[...new Set(clients.map((client) => client.tariff))].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          ) : null}
          <input
            type="search"
            className={styles.search}
            aria-label="Поиск"
            placeholder={
              section === 'installs' || section === 'clients'
                ? 'Телефон, ID, поддомен, название, имя или email'
                : 'Поиск по разделу'
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      {visible.length ? (
        <DataTable rows={visible} columns={columns} rowKey={(row) => row.id} />
      ) : (
        <EmptyState
          title="Ничего не найдено"
          description="Попробуйте изменить поиск или фильтры."
        />
      )}
    </>
  )
}

function Statistics() {
  const counts = [18, 26, 22, 34, 29, 40]
  return (
    <div className={styles.statistics}>
      <div className={styles.summary}>
        {[
          ['Новые аккаунты', '74'],
          ['Новые установки', '169'],
          ['Оплатили', '28'],
        ].map(([label, value]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <section className={styles.chart}>
        <h2>Новые установки по неделям</h2>
        <ul>
          {counts.map((count, index) => (
            <li key={index} aria-label={`Неделя ${index + 1}: ${count}`}>
              <span>{count}</span>
              <span className={styles.barTrack} aria-hidden="true">
                <span className={styles.bar} style={{ height: `${(count / 40) * 100}%` }} />
              </span>
              <small>{index + 1} нед.</small>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
