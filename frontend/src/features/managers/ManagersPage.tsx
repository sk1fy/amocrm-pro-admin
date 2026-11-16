import { useRef, useState } from 'react'
import { Link, useSearch } from '@tanstack/react-router'
import { BrandLogo } from '../../components/BrandLogo'
import { DataTable, type DataTableColumn } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { boards, clients, dateLabel, installs, type Cell, type DemoRow } from './fixtures'
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

function CellValue({ value }: { value: Cell }) {
  if (typeof value === 'string') return value
  return (
    <>
      {value.line ? (
        <span className={styles.line} data-line={value.line}>
          {value.line}
        </span>
      ) : null}
      {value.detail ? (
        <details className={styles.dealDetails}>
          <summary>{value.text}</summary>
          <p>{value.detail}</p>
          <small>Локальный пример · CRM не открывается</small>
        </details>
      ) : (
        <span className={value.tone ? styles.pill : undefined} data-tone={value.tone}>
          {value.text}
        </span>
      )}
      {value.note ? <small className={styles.note}>{value.note}</small> : null}
      {value.tags?.length ? (
        <span className={styles.tags}>
          {value.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </span>
      ) : null}
    </>
  )
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
          <ClientProfile
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

const clientTabs = [
  'Наши виджеты',
  'Портрет клиента',
  'Аудит',
  'История',
  'Счета и компании',
  'Пользователи',
  'Установленные виджеты',
] as const

function ClientProfile({
  client,
  section,
  rows,
  check,
}: {
  client: (typeof clients)[number]
  section: Section
  rows: readonly DemoRow[]
  check: (id: string, checked: boolean) => void
}) {
  const [tab, setTab] = useState<(typeof clientTabs)[number]>(clientTabs[0])
  const [status, setStatus] = useState(client.owner)
  const [note, setNote] = useState('Уточнить задачи команды и показать подходящие виджеты.')
  const [refreshed, setRefreshed] = useState(false)
  const accountRows = rows.filter((item) => item.client === client.id)
  const invoiceRows = boards.invoices.rows.filter((item) => item.client === client.id)
  const activityRows = boards.feed.rows.filter((item) => item.client === client.id)
  const body = {
    'Наши виджеты': {
      columns: [
        'Статус · установлен',
        'Виджет',
        'Оплачен до',
        'Установил',
        'Сделка',
        'Контакт из формы активации',
      ],
      rows: accountRows.map((row) => ({
        ...row,
        cells: [
          row.installationStatus ?? '—',
          row.cells[1],
          row.paidUntil ?? '—',
          row.installer ?? '—',
          row.cells[5],
          row.cells[4],
        ],
      })),
    },
    'Портрет клиента': {
      columns: ['Тариф', 'Пользователей', 'Чей клиент'],
      rows: [{ id: client.id, cells: [client.tariff, client.seats, client.owner] }],
    },
    Аудит: {
      columns: ['Проверка', 'Состояние', 'Данные обновлены'],
      rows: [{ id: client.id, cells: ['Доступ к amoCRM', client.health, client.updated] }],
    },
    История: { columns: boards.feed.columns, rows: activityRows },
    'Счета и компании': { columns: boards.invoices.columns, rows: invoiceRows },
    Пользователи: {
      columns: ['Контакт', 'Пользователей в аккаунте'],
      rows: [{ id: client.id, cells: [client.email, client.seats] }],
    },
    'Установленные виджеты': {
      columns: ['Виджет', 'Дата установки'],
      rows: accountRows.map((row) => ({ ...row, cells: [row.cells[1], row.cells[0]] })),
    },
  }[tab]

  return (
    <>
      <nav className={styles.crumbs} aria-label="Хлебные крошки">
        <Link to="/managers" search={{ section, client: undefined }}>
          {sections[section].title}
        </Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page">{client.domain}</span>
      </nav>
      <section className={styles.client}>
        <header>
          <div className={styles.avatar} aria-hidden="true">
            {client.name.slice(0, 1)}
          </div>
          <div className={styles.clientTitle}>
            <div className={styles.nameRow}>
              <h1>{client.domain}</h1>
              <span className={styles.idChip}>ID {client.id}</span>
            </div>
            <p>
              {client.name} · данные обновлены: {client.updated}
            </p>
            <span
              className={styles.pill}
              data-tone={client.health === 'Получаем данные' ? 'green' : 'amber'}
            >
              {client.health}
            </span>
          </div>
          <label className={styles.clientStatus}>
            Статус клиента
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {['Без партнёра', 'Наш клиент', 'Клиент партнёра', 'Запрет работы'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <small>До выхода из карточки · демо</small>
          </label>
        </header>
        <div className={styles.statbar}>
          <div>
            <small>Тариф amoCRM</small>
            <strong>{client.tariff}</strong>
            <span className={styles.note}>
              {client.health === 'Лицензия истекла' ? 'Лицензия истекла' : 'Данные демо-аккаунта'}
            </span>
          </div>
          <div>
            <small>Действует до</small>
            <strong>{dateLabel(client.till)}</strong>
            <button className={styles.textButton} onClick={() => setTab('История')}>
              История продлений →
            </button>
          </div>
          <div>
            <small>Пользователи</small>
            <button className={styles.metricButton} onClick={() => setTab('Пользователи')}>
              {client.seats}
            </button>
            <span className={styles.note}>В аккаунте amoCRM</span>
          </div>
          <div>
            <small>Бонусы</small>
            <strong>{client.id === '91001001' ? '2 400 ₽' : '0 ₽'}</strong>
            <span className={styles.note}>Демонстрационный баланс</span>
          </div>
          <div>
            <button className={styles.refreshButton} onClick={() => setRefreshed(true)}>
              ↻ Обновить
            </button>
            <span role="status" className={styles.note}>
              {refreshed
                ? 'Демо-данные актуальны · запрос не отправлялся'
                : 'Локальный пример обновления'}
            </span>
          </div>
        </div>
        {status !== 'Клиент партнёра' && status !== 'Запрет работы' ? (
          <div className={styles.nextStep}>
            <strong>Следующий шаг</strong>
            <span>Уточнить, как команда работает со сделками</span>
            <button className={styles.textButton} onClick={() => setTab('Портрет клиента')}>
              Перейти →
            </button>
          </div>
        ) : null}
      </section>
      <div className={styles.clientCards}>
        <section className={styles.detailCard}>
          <h2>Подписка</h2>
          <div className={styles.subscription}>
            <strong>
              {client.owner === 'Наш клиент'
                ? 'Все TOP · Наш клиент'
                : 'Единая подписка не подключена'}
            </strong>
            <span
              className={styles.pill}
              data-tone={client.owner === 'Наш клиент' ? 'green' : 'gray'}
            >
              {client.owner === 'Наш клиент' ? 'Действует' : 'Нет подписки'}
            </span>
          </div>
          <p>
            {client.owner === 'Наш клиент'
              ? `Все TOP-виджеты до ${dateLabel(client.till)} · ${client.seats} пользователей`
              : 'Каждый виджет работает по своему сроку оплаты или пробного периода.'}
          </p>
          <small className={styles.note}>
            Демонстрация условий подписки · управление оплатой не подключено
          </small>
        </section>
        <section className={styles.detailCard}>
          <label htmlFor="manager-client-note">
            <h2>Заметка менеджера</h2>
          </label>
          <textarea
            id="manager-client-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
          />
          <small className={styles.note}>Черновик сохраняется в карточке до выхода из неё</small>
        </section>
      </div>
      <div className={styles.tabs} role="group" aria-label="Разделы карточки">
        {clientTabs.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {value}
            <span className={styles.count}>
              {value === 'Наши виджеты' || value === 'Установленные виджеты'
                ? accountRows.length
                : value === 'Пользователи'
                  ? client.seats
                  : value === 'История'
                    ? activityRows.length
                    : value === 'Счета и компании'
                      ? invoiceRows.length
                      : value === 'Аудит'
                        ? '1'
                        : '—'}
            </span>
          </button>
        ))}
      </div>
      {body?.rows.length ? (
        <DataTable<DemoRow>
          rows={body.rows}
          rowKey={(row) => row.id}
          columns={[
            ...body.columns.map((header, index) => ({
              id: header,
              header,
              cell: (row: DemoRow) => <CellValue value={row.cells[index]} />,
            })),
            ...(tab === 'Наши виджеты'
              ? [
                  {
                    id: 'actions',
                    header: 'Действия',
                    cell: (row: DemoRow) => (
                      <button
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
                  },
                ]
              : []),
          ]}
        />
      ) : (
        <EmptyState title="Нет тестовых записей" />
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
