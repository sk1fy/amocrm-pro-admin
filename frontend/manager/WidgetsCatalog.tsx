import { useEffect, useState, type FormEvent } from 'react'
import { StatusBadge } from '../src/components/StatusBadge'
import { formatTime } from '../src/lib/format'
import { accountSearch, listSearch, ManagerLink } from './accountsLocation'
import type { Product, ProductOverview } from './productsApi'
import { separateProductLinks } from './productLinks'
import styles from './WidgetsCatalog.module.css'

const lines = ['FREE', 'TOP', 'PRO'] as const
const number = new Intl.NumberFormat('ru-RU')
const percentage = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 })
const monthName = new Intl.DateTimeFormat('ru-RU', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

type Summary = ProductOverview['summary']
type Statistics = ProductOverview['statistics'][string]

function value(amount: number | undefined) {
  return amount === undefined ? '—' : number.format(amount)
}

function share(part: number, total: number) {
  return total === 0 ? '—' : percentage.format(part / total)
}

export function WidgetSummary({ summary }: { summary: Summary }) {
  const cards = [
    {
      metric: value(summary.total),
      label: 'Виджетов',
      note: lines.map((line) => line + ' ' + value(summary.by_line[line])).join(' · '),
    },
    {
      metric: value(summary.current),
      label: 'Стоят сейчас',
      note: 'За 12 мес. · ' + value(summary.installations),
    },
    {
      metric: '+' + value(summary.recent),
      label: 'Установок за 30 дней',
      note: 'Подтверждённые установки',
    },
    {
      metric: share(summary.activated, summary.activation_eligible),
      label: 'Активировали',
      note: summary.activation_eligible ? 'По записанным активациям' : 'Нет данных об активациях',
    },
    {
      metric: value(summary.attention),
      label: 'Требуют внимания',
      note: 'Потеря связи, активация ниже 90%, ссылки',
      attention: summary.attention > 0,
    },
  ]
  return (
    <div className={styles.summary} aria-label="Сводка каталога" role="group">
      {cards.map(({ metric, label, note, attention }) => (
        <div className={styles.summaryCard} data-attention={attention} key={label}>
          <strong>{metric}</strong>
          <span>{label}</span>
          <small>{note}</small>
        </div>
      ))}
    </div>
  )
}

export function WidgetFilters({
  query,
  canStats,
  summary,
  apply,
}: {
  query: URLSearchParams
  canStats: boolean
  summary?: Summary
  apply: (updates: Record<string, string | null>) => void
}) {
  const q = query.get('q') ?? ''
  const [draft, setDraft] = useState({ query: q, value: q })
  if (draft.query !== q) setDraft({ query: q, value: q })
  const trimmed = draft.value.trim()
  useEffect(() => {
    if (trimmed === q) return
    const timer = window.setTimeout(() => apply({ q: trimmed }), 300)
    return () => window.clearTimeout(timer)
  }, [apply, q, trimmed])

  function change(updates: Record<string, string | null>) {
    apply({ q: trimmed, ...updates })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    change({})
  }

  return (
    <form className={styles.toolbar} aria-label="Фильтры виджетов" onSubmit={submit}>
      <div className={styles.filterStart}>
        <div className={styles.lines} aria-label="Линейка" role="group">
          {(['', ...lines] as const).map((line) => {
            const count = line === '' ? summary?.total : summary?.by_line[line]
            return (
              <button
                key={line}
                type="button"
                aria-pressed={line === (query.get('line') ?? '')}
                onClick={() => change({ line })}
              >
                {line || 'Все'}
                {count === undefined ? null : <span>{value(count)}</span>}
              </button>
            )
          })}
        </div>
        {canStats ? (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={query.get('attention') === 'true'}
              onChange={(event) => change({ attention: event.target.checked ? 'true' : null })}
            />
            Только требующие внимания
          </label>
        ) : null}
      </div>
      <div className={styles.filterEnd}>
        {canStats ? (
          <label>
            Сортировка
            <select
              value={query.get('sort') ?? 'installations'}
              onChange={(event) =>
                change({ sort: event.target.value === 'installations' ? null : event.target.value })
              }
            >
              <option value="installations">Больше установок</option>
              <option value="name">По названию</option>
              <option value="code">По коду</option>
            </select>
          </label>
        ) : null}
        <select
          aria-label="Доступность"
          value={query.get('availability') ?? ''}
          onChange={(event) => change({ availability: event.target.value })}
        >
          <option value="">Все статусы</option>
          <option value="draft">Черновик</option>
          <option value="pilot">Пилот</option>
          <option value="active">Доступен</option>
          <option value="archived">Архив</option>
        </select>
        <input
          type="search"
          aria-label="Поиск виджетов"
          placeholder="Название или код виджета"
          value={draft.value}
          maxLength={200}
          onChange={(event) => setDraft({ query: q, value: event.target.value })}
        />
      </div>
    </form>
  )
}

function InstallationsChart({ stats }: { stats: Statistics }) {
  const highest = Math.max(1, ...stats.months.map(({ count }) => count))
  const months = stats.months.map(({ month, count }) => ({
    month,
    count,
    label: monthName.format(new Date(month + '-01T00:00:00Z')) + ' — ' + value(count),
  }))
  return (
    <div className={styles.installations}>
      <div
        className={styles.chart}
        role="img"
        aria-label={months.map(({ label }) => label).join(', ')}
      >
        {months.map(({ month, count, label }) => (
          <span
            key={month}
            title={label}
            style={{ height: Math.max(2, (100 * count) / highest) + '%' }}
            data-zero={count === 0}
          />
        ))}
      </div>
      <div>
        <strong>{value(stats.installations)}</strong>
        <small title="Подтверждённые установки за последние 30 дней">
          +{value(stats.recent)} за 30 дн.
        </small>
      </div>
    </div>
  )
}

function Activation({ stats }: { stats: Statistics }) {
  if (!stats.activation_eligible) return <span className={styles.muted}>Нет данных</span>
  const ratio = stats.activated / stats.activation_eligible
  return (
    <div title="По подтверждённым установкам с момента первого записанного сигнала для интеграции">
      <div className={styles.activation}>
        <span className={styles.progress} data-low={ratio < 0.9} aria-hidden="true">
          <span style={{ width: 100 * ratio + '%' }} />
        </span>
        {share(stats.activated, stats.activation_eligible)}
      </div>
      <small>{value(stats.activation_eligible - stats.activated)} без записи</small>
    </div>
  )
}

function Attention({ stats }: { stats: Statistics }) {
  const low =
    stats.activation_eligible > 0 && stats.activated * 100 < stats.activation_eligible * 90
  if (
    !stats.connection_count &&
    !low &&
    !stats.missing_install_link &&
    !stats.missing_instruction
  ) {
    return <StatusBadge domain="product_attention" state="no_known_issues" variant="text" />
  }
  return (
    <div className={styles.attention}>
      {stats.connection_count > 0 ? (
        <StatusBadge
          domain="product_attention"
          state="connection"
          title={value(stats.connection_count) + ' подключений требуют повторной авторизации'}
        />
      ) : null}
      {low ? <StatusBadge domain="product_attention" state="activation" /> : null}
      {stats.missing_install_link ? (
        <StatusBadge domain="product_attention" state="installation_link" />
      ) : null}
      {stats.missing_instruction ? (
        <StatusBadge domain="product_attention" state="instruction_link" />
      ) : null}
    </div>
  )
}

function ProductLine({ line }: { line: Product['line'] }) {
  return (
    <span className={styles.productLine} data-line={line}>
      <StatusBadge domain="product_line" state={line} />
    </span>
  )
}

function WidgetLinks({ links }: Pick<Product, 'links'>) {
  const { installation, instruction } = separateProductLinks(links)
  return (
    <ul className={styles.links}>
      <li data-kind="installation" className={installation ? undefined : styles.linkMissing}>
        {installation ? (
          <a href={installation.url} target="_blank" rel="noreferrer">
            Установка
          </a>
        ) : (
          'Нет ссылки на установку'
        )}
      </li>
      <li data-kind="instruction" className={instruction ? undefined : styles.linkMissing}>
        {instruction ? (
          <a href={instruction.url} target="_blank" rel="noreferrer">
            Инструкция <span aria-hidden="true">↗</span>
          </a>
        ) : (
          'Нет инструкции'
        )}
      </li>
    </ul>
  )
}

export function WidgetTable({
  products,
  statistics,
  showStats,
  productLocation,
  navigate,
}: {
  products: Product[]
  statistics?: ProductOverview['statistics']
  showStats: boolean
  productLocation: (id: Product['id']) => string
  navigate: (search: string) => void
}) {
  return (
    <div
      className={styles.tableFrame}
      role="region"
      aria-label="Каталог виджетов"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Enable horizontal keyboard scrolling.
      tabIndex={0}
    >
      <table className={styles.table} data-with-stats={showStats}>
        <thead>
          <tr>
            <th scope="col">Виджет</th>
            {showStats ? (
              <>
                <th scope="col">Установки за 12 мес.</th>
                <th scope="col">Стоят сейчас</th>
                <th scope="col">Активировали</th>
                <th scope="col">Требует внимания</th>
              </>
            ) : null}
            <th scope="col">Тест · тариф</th>
            <th scope="col">Ссылки</th>
          </tr>
        </thead>
        <tbody>
          {products.map((row) => {
            const stats = statistics?.[row.id]
            const location = productLocation(row.id)
            return (
              <tr key={row.id}>
                <td>
                  <div className={styles.name}>
                    <ProductLine line={row.line} />
                    <ManagerLink search={location} navigate={navigate}>
                      {row.display_name}
                    </ManagerLink>
                    {row.availability !== 'active' ? (
                      <StatusBadge domain="product_availability" state={row.availability} />
                    ) : null}
                  </div>
                  <small>{row.code}</small>
                </td>
                {showStats ? (
                  <>
                    <td>{stats ? <InstallationsChart stats={stats} /> : '—'}</td>
                    <td>
                      {value(stats?.current)}
                      {stats?.installations ? (
                        <small title="Доля открытых установок среди подтверждённых за 12 месяцев">
                          {share(stats.retained, stats.installations)} остались
                        </small>
                      ) : null}
                    </td>
                    <td>{stats ? <Activation stats={stats} /> : '—'}</td>
                    <td>{stats ? <Attention stats={stats} /> : '—'}</td>
                  </>
                ) : null}
                <td className={styles.trial}>
                  {row.trial_policy.kind === 'once' && row.trial_policy.duration_days !== null ? (
                    <span>{row.trial_policy.duration_days} дн.</span>
                  ) : (
                    <StatusBadge domain="product_trial" state={row.trial_policy.kind} calm />
                  )}
                  {row.tariff_version === null ? null : <small>Версия {row.tariff_version}</small>}
                </td>
                <td>
                  <WidgetLinks links={row.links} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function WidgetConnectionProblems({
  overview,
  search,
  productLocation,
  navigate,
}: {
  overview: ProductOverview
  search: string
  productLocation: (id: Product['id']) => string
  navigate: (search: string) => void
}) {
  const total = overview.summary.connection_count
  if (total === 0) return null
  return (
    <section aria-labelledby="widget-problems-heading" className={styles.problems}>
      <header>
        <h2 id="widget-problems-heading">Нет связи — нужна повторная авторизация</h2>
        <span>{value(total)}</span>
        <p>Подтверждённые случаи потери доступа к amoCRM.</p>
      </header>
      <div
        className={styles.tableFrame}
        role="region"
        aria-label="Подключения без авторизации"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Enable horizontal keyboard scrolling.
        tabIndex={0}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Нет связи с</th>
              <th scope="col">Виджет</th>
              <th scope="col">Аккаунт</th>
              <th scope="col">ID amoCRM</th>
              <th scope="col">Состояние</th>
            </tr>
          </thead>
          <tbody>
            {overview.connections.map((row) => (
              <tr key={row.installation_id}>
                <td>
                  {row.since ? <time dateTime={row.since}>{formatTime(row.since)}</time> : '—'}
                </td>
                <td>
                  <ProductLine line={row.line} />{' '}
                  <ManagerLink search={productLocation(row.product_id)} navigate={navigate}>
                    {row.name}
                  </ManagerLink>
                </td>
                <td>
                  <ManagerLink
                    search={accountSearch(listSearch(search, 'clients'), row.account_id)}
                    navigate={navigate}
                  >
                    {row.account_domain?.split('.')[0] ?? row.account_name ?? row.amo_account_id}
                  </ManagerLink>
                  {row.account_domain && row.account_name ? (
                    <small>{row.account_name}</small>
                  ) : null}
                </td>
                <td>{row.amo_account_id}</td>
                <td>
                  <StatusBadge domain="installation_authorization" state="reauth_required" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > overview.connections.length ? (
        <p>
          Показаны {value(overview.connections.length)} из {value(total)} подключений.
        </p>
      ) : null}
    </section>
  )
}
