import { useRef, useState } from 'react'
import { Link, useSearch } from '@tanstack/react-router'
import { BrandLogo } from '../../components/BrandLogo'
import { DataTable, type DataTableColumn } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { boards, type DemoRow } from './fixtures'
import { DemoSession, useDemo, can, canView, today } from './DemoSession'
import { InvoiceDrawer } from './Finance'
import { WidgetsBoard } from './WidgetsBoard'
import { MarketBoard } from './MarketBoard'
import { StaffBoard } from './StaffBoard'
import { StatsBoard } from './StatsBoard'
import { PartnerEntry, usePartnerPaymentRequests } from './Partners'
import { PartnersBoard } from './PartnersBoard'
import { PaymentsBoard, useUnreviewedPaymentCount } from './PaymentsBoard'
import { AccountDrafts, DraftAccount, useAccountDraft } from './AccountDrafts'
import { AccountProfile } from './AccountProfile'
import { ClientsBoard } from './ClientsBoard'
import { InvoicesBoard } from './InvoicesBoard'
import { FeedBoard } from './FeedBoard'
import { isInvoiceStale } from './invoiceFixtures'
import { findDemoClient } from './clientDirectory'
import { portraitTopics } from './portraitTopics'
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
    (digits.length >= 3 &&
      /^[+()\d\s-]+$/.test(term) &&
      phone.replace(/^[78](?=\d{10}$)/, '').includes(digits.replace(/^[78](?=\d{10}$)/, '')))
  )
}

export function ManagersPage() {
  const { mode } = useSearch({ from: '/managers' })
  return (
    <DemoSession>
      <AccountDrafts>{mode === 'partner' ? <PartnerEntry /> : <ManagerWorkspace />}</AccountDrafts>
    </DemoSession>
  )
}

function ManagerWorkspace() {
  const { state, actor, actorId, selectActor, dispatch } = useDemo()
  const { section, client } = useSearch({ from: '/managers' })
  const [partnerPaymentRequests] = usePartnerPaymentRequests()
  const unreviewedPayments = useUnreviewedPaymentCount()
  const [topics, setTopics] = useAccountDraft('/portraitTopics', portraitTopics)
  const [menuOpen, setMenuOpen] = useState(() => window.innerWidth >= 1440)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const customer = findDemoClient(client)
  const rows = state.rows
  const check = (id: string, value: boolean) =>
    dispatch({
      type: 'install',
      id,
      patch: {
        group: value ? 'Проверенные' : 'Непроверенные',
        checkedBy: value ? actor.name : undefined,
      },
      title: value ? 'Установка проверена' : 'Проверка снята',
    })
  const uncheckedCount = rows.filter((item) => item.group === 'Непроверенные').length

  const sectionOverview = section !== 'installs' && !client
  const counts: Partial<Record<Section, number>> = {
    installs: uncheckedCount,
    payments: unreviewedPayments,
    partners: partnerPaymentRequests.filter((request) => request.status === 'pending').length,
    invoices: state.invoices.filter((invoice) => !invoice.legacy && isInvoiceStale(invoice, today))
      .length,
  }

  return (
    <div
      className={styles.shell}
      data-overview={sectionOverview || undefined}
      data-menu-open={menuOpen}
      data-mobile-open={mobileMenuOpen}
    >
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
          <label>
            {sectionOverview ? 'Вы вошли как ' : 'Войти как '}
            <select
              aria-label="Демо-сотрудник"
              value={actorId}
              onChange={(e) => selectActor(e.target.value)}
            >
              {state.staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <Link to="/login" search={{ next: undefined }}>
            Сменить кабинет
          </Link>
        </div>
        {sectionOverview ? (
          <span className={styles.demoServer} title="Статус в демо-данных">
            w.rkrs.ru · работает
          </span>
        ) : null}
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
          {sectionKeys
            .filter((key) => canView(actor, key))
            .map((key) => {
              const item = sections[key]
              const count = counts[key] ?? 0
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
                      {key === 'partners' ? ' запр.' : ''}
                    </span>
                  ) : null}
                </Link>
              )
            })}
        </nav>
      </aside>
      <main className={styles.main}>
        <div className={styles.demo}>
          {sectionOverview
            ? 'Демо-данные: виджеты, компании, партнёры, люди и телефоны выдуманы. Правки и кнопки работают только в этой вкладке.'
            : 'Демо-данные. Изменения действуют до обновления страницы.'}
        </div>
        {customer ? (
          <DraftAccount id={customer.id}>
            <AccountProfile
              key={customer.id}
              client={customer}
              section={section}
              rows={rows}
              topics={topics}
              changeTopics={setTopics}
              check={check}
            />
          </DraftAccount>
        ) : client ? (
          <EmptyState
            title="Клиент не найден"
            action={
              <Link to="/managers" search={{ section, client: undefined }}>
                Вернуться к списку
              </Link>
            }
          />
        ) : !canView(actor, section) ? (
          <EmptyState
            title="Нет доступа к разделу"
            description="Выберите доступный раздел или смените демо-сотрудника."
          />
        ) : section === 'clients' ? (
          <ClientsBoard />
        ) : section === 'widgets' ? (
          <WidgetsBoard />
        ) : section === 'market' ? (
          <MarketBoard />
        ) : section === 'staff' ? (
          <StaffBoard />
        ) : section === 'partners' ? (
          <PartnersBoard />
        ) : section === 'invoices' ? (
          <InvoicesBoard />
        ) : section === 'payments' ? (
          <PaymentsBoard />
        ) : section === 'stats' ? (
          <StatsBoard />
        ) : section === 'feed' ? (
          <FeedBoard />
        ) : (
          <InstallationsBoard rows={rows} check={check} />
        )}
      </main>
      <InvoiceDrawer />
    </div>
  )
}

function InstallationsBoard({
  rows,
  check,
}: {
  rows: readonly DemoRow[]
  check: (id: string, checked: boolean) => void
}) {
  const { actor } = useDemo()
  const board = boards.installs
  const [group, setGroup] = useState(board.filters?.[0] ?? '')
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const candidates = rows.filter(
    (row) =>
      matches(row, query) && (!from || (row.date ?? '') >= from) && (!to || (row.date ?? '') <= to),
  )
  const visible = candidates.filter((row) => !group || row.group === group)
  const columns: DataTableColumn<DemoRow>[] = board.columns.map((header, index) => ({
    id: header,
    header,
    cell: (row) => (
      <>
        {row.client && (index === 2 || index === 3) ? (
          <Link
            className={styles.rowLink}
            to="/managers"
            search={{ section: 'installs', client: row.client }}
          >
            <CellValue value={row.cells[index]} />
          </Link>
        ) : (
          <CellValue value={row.cells[index]} />
        )}
      </>
    ),
  }))
  if (can(actor, 'clients')) {
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
            `Вернуть · ${row.checkedBy ?? 'демо'}`
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
        <h1>{sections.installs.title}</h1>
        <p className={styles.description}>{board.description}</p>
      </header>
      <div className={styles.installControls}>
        {board.filters ? (
          <div className={styles.tabs} aria-label="Фильтр по состоянию" role="group">
            {board.filters.map((filter) => (
              <button
                key={filter}
                type="button"
                aria-pressed={group === filter}
                onClick={() => setGroup(filter)}
              >
                {filter}
                <span className={styles.count}>
                  {candidates.filter((row) => row.group === filter).length}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div className={styles.filters}>
          <button
            type="button"
            onClick={() => {
              setFrom('')
              setTo('')
              setQuery('')
              setGroup(board.filters?.[0] ?? '')
            }}
          >
            Сбросить фильтры
          </button>
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
          <input
            type="search"
            className={styles.search}
            aria-label="Поиск"
            placeholder="Телефон, ID, поддомен, название, имя или email"
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
