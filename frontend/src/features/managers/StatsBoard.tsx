import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { findDemoClient } from './clientDirectory'
import { canView, money, useDemo } from './DemoSession'
import { dateLabel } from './fixtures'
import { defaultPartnerFilters } from './partnerDirectorySearch'
import { usePartners } from './Partners'
import { ColumnChart, RankChart, statisticNumber } from './StatisticsCharts'
import { statisticsData, statisticsWidgets, type StatisticsData } from './statisticsData'
import {
  defaultStatisticsFilters,
  statisticsPresets,
  statisticsTrialFilters,
  type StatisticsFilters,
  type StatisticsTrialFilter,
} from './statisticsSearch'
import styles from './StatsBoard.module.css'

function Card({
  title,
  description,
  action,
  wide,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  wide?: boolean
  children: ReactNode
}) {
  return (
    <section className={styles.card} data-wide={wide}>
      <header className={styles.cardHeader}>
        <h2>{title}</h2>
        {description && <span>{description}</span>}
        {action}
      </header>
      {children}
    </section>
  )
}

function WidgetLabel({ widget }: { widget: (typeof statisticsWidgets)[number] }) {
  return (
    <>
      <span className={styles.tier} data-tier={widget.tier}>
        {widget.tier}
      </span>{' '}
      {widget.name}
    </>
  )
}

function TrialTable({
  trial,
  rows,
}: {
  trial: StatisticsTrialFilter
  rows: StatisticsData['trials'][StatisticsTrialFilter]
}) {
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table} aria-label={statisticsTrialFilters[trial].label}>
        <thead>
          <tr>
            <th scope="col">Виджет</th>
            <th scope="col">Аккаунт</th>
            <th scope="col">Чей клиент</th>
            <th scope="col">{trial === 'paid' ? 'Оплатили' : 'Тест до'}</th>
            <th scope="col">Деньгами</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map(({ widget, client, trialEnd, removed, purchase }, index) => {
              const account = findDemoClient(client)
              return (
                <tr key={`${client}-${widget}-${index}`}>
                  <td>
                    <WidgetLabel widget={statisticsWidgets[widget]} />
                    {removed && <small>Удалён {dateLabel(removed)}</small>}
                  </td>
                  <td>
                    <Link to="/managers" search={{ section: 'stats', client }}>
                      {account?.domain ?? client}
                    </Link>
                    <small>ID {client}</small>
                  </td>
                  <td>{account?.owner ?? '—'}</td>
                  <td>{dateLabel(purchase?.date ?? trialEnd)}</td>
                  <td>{purchase ? money(purchase.money) : '—'}</td>
                </tr>
              )
            })
          ) : (
            <tr>
              <td colSpan={5}>Нет данных за выбранный период.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

const trialKeys = Object.keys(statisticsTrialFilters) as StatisticsTrialFilter[]
const presetOptions = Object.keys(statisticsPresets).map(Number) as StatisticsFilters['days'][]
const countSeries = [{ name: 'Новые установки', color: 'var(--color-primary)' }]
const accountSeries = [{ name: 'Новые аккаунты', color: '#169c8f' }]
const churnSeries = [{ name: 'Удалили', color: '#9b5de5' }]
const revenueSeries = [
  { name: 'Карта', color: '#3b7be8' },
  { name: 'Расчётный счёт', color: '#169c8f' },
]

function compactNumber(value: number) {
  if (value >= 1_000_000)
    return (value / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млн'
  if (value >= 10_000) return Math.round(value / 1000) + ' тыс'
  return statisticNumber(value)
}

export function StatsBoard() {
  const { state, actor } = useDemo()
  const [partners] = usePartners()
  const { statisticsFilters: filters = defaultStatisticsFilters } = useSearch({ from: '/managers' })
  const navigate = useNavigate({ from: '/managers' })
  const data = statisticsData(state, filters)
  const partnersById = new Map(partners.map(({ id, name }) => [id, name]))

  function change(patch: Partial<StatisticsFilters>) {
    void navigate({
      search: (previous) => ({ ...previous, statisticsFilters: { ...filters, ...patch } }),
      replace: true,
      resetScroll: false,
    })
  }

  function partnerLabel(idOrName: number | string) {
    const name = typeof idOrName === 'number' ? partnersById.get('directory-' + idOrName) : idOrName
    if (!name) return '—'
    if (!canView(actor, 'partners')) return name
    return (
      <Link
        to="/managers"
        search={{
          section: 'partners',
          client: undefined,
          partnerDirectory: { ...defaultPartnerFilters, query: name },
        }}
      >
        {name}
      </Link>
    )
  }

  return (
    <div className={styles.board}>
      <header className={styles.heading}>
        <h1>Статистика</h1>
        <p>
          Тестовые аккаунты («Запрет работы») не считаются. Наведите на столбик — точные цифры; под
          графиком — таблица.
        </p>
      </header>

      <div className={styles.filters}>
        <div className={styles.group} role="group" aria-label="Период статистики">
          {presetOptions.map((days) => (
            <button
              type="button"
              key={days}
              aria-pressed={!filters.from && !filters.to && days === filters.days}
              onClick={() => change({ days, from: '', to: '' })}
            >
              {statisticsPresets[days]}
            </button>
          ))}
        </div>
        <div className={styles.dates}>
          <label>
            или с
            <input
              type="date"
              aria-label="Период с"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) => change({ from: event.target.value })}
            />
          </label>
          <label>
            по
            <input
              type="date"
              aria-label="Период по"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => change({ to: event.target.value })}
            />
          </label>
        </div>
        <span className={styles.range}>
          Период: {dateLabel(data.range.from)} — {dateLabel(data.range.to)}
        </span>
      </div>

      <div className={styles.grid}>
        <Card
          title="Самые популярные виджеты"
          description="новые установки за период · уникальные аккаунты"
        >
          <RankChart
            rows={data.widgetRanks.map((widget) => ({
              key: widget.code,
              label: <WidgetLabel widget={widget} />,
              value: widget.value,
              color: widget.color,
              note: `активировали ${widget.activation}% · оплатили ${widget.paid} · удалили ${widget.removed}`,
            }))}
          />
        </Card>
        <Card
          title="Новые аккаунты"
          description="впервые появились у нас · по неделям за 6 месяцев"
        >
          <div className={styles.metric} aria-label="Новых аккаунтов за выбранный период">
            <strong>{data.newAccountCount}</strong> <span>за выбранный период</span>
          </div>
          <ColumnChart
            label="Новые аккаунты по неделям"
            buckets={data.newAccountWeeks}
            series={accountSeries}
            every={4}
          />
        </Card>
        <Card
          title="Новые установки по неделям"
          description="26 недель · без переустановок и повторных авторизаций"
          action={
            <div className={styles.group} role="group" aria-label="Разбивка установок">
              <button
                type="button"
                aria-pressed={!filters.split}
                onClick={() => change({ split: false })}
              >
                Общее
              </button>
              <button
                type="button"
                aria-pressed={filters.split}
                onClick={() => change({ split: true })}
              >
                По виджетам
              </button>
            </div>
          }
          wide
        >
          <ColumnChart
            label="Новые установки по неделям"
            buckets={data.installationWeeks}
            series={
              filters.split
                ? statisticsWidgets.map(({ name, color }) => ({ name, color }))
                : countSeries
            }
            every={2}
          />
        </Card>
      </div>

      <div className={styles.sectionTitle}>
        <h2>Партнёры — топ-10</h2>
        <span>за выбранный период</span>
      </div>
      <div className={styles.partnerGrid}>
        <Card title="Новые аккаунты" description="закрепились за партнёром">
          <RankChart
            rows={data.partnerAccountRanks.map((row) => ({ ...row, label: partnerLabel(row.key) }))}
          />
        </Card>
        <Card title="Установки виджетов" description="с номером или промокодом партнёра">
          <RankChart
            rows={data.partnerInstallationRanks.map((row) => ({
              ...row,
              label: partnerLabel(row.key),
            }))}
          />
        </Card>
        <Card title="Какие виджеты ставят партнёры">
          <RankChart
            rows={data.partnerWidgetRanks.map((widget) => ({
              ...widget,
              key: widget.code,
              label: <WidgetLabel widget={widget} />,
            }))}
          />
        </Card>
        <Card title="Сумма оплат" description="живые деньги: счета и карты">
          <RankChart
            rows={data.partnerPayments.map((row) => ({ ...row, label: partnerLabel(row.key) }))}
            format={money}
          />
        </Card>
        <Card title="Последняя активация" description="активность партнёров за всё время">
          <div className={styles.tableScroll}>
            <table className={styles.table} aria-label="Последние активации партнёров">
              <tbody>
                {data.partnerActivations.map(([id, date], index) => (
                  <tr key={id}>
                    <td>{index + 1}</td>
                    <th scope="row">{partnerLabel(id)}</th>
                    <td>{dateLabel(date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className={styles.sectionTitle}>
        <h2>Тесты платных виджетов</h2>
        <span>TOP и PRO · без тестовых аккаунтов и тех, кого покрывает подписка</span>
      </div>
      <div className={styles.card}>
        <div className={styles.trialTiles} role="group" aria-label="Фильтр тестов">
          {trialKeys.map((trial) => (
            <button
              type="button"
              key={trial}
              aria-pressed={trial === filters.trial}
              data-warning={trial === 'ending' && data.trials.ending.length > 0}
              onClick={() => change({ trial: filters.trial === trial ? undefined : trial })}
            >
              <strong>{data.trials[trial].length}</strong>
              <span>{statisticsTrialFilters[trial].label}</span>
              <small>{statisticsTrialFilters[trial].hint}</small>
            </button>
          ))}
        </div>
        {filters.trial && <TrialTable trial={filters.trial} rows={data.trials[filters.trial]} />}
      </div>

      <div className={styles.sectionTitle}>
        <h2>Что ещё можно считать</h2>
        <span>примеры на демо-данных</span>
      </div>
      <div className={styles.grid}>
        <Card title="Выручка по месяцам" description="только живые деньги">
          <ColumnChart
            label="Выручка по месяцам"
            buckets={data.revenue}
            series={revenueSeries}
            column="Месяц"
            format={money}
            formatTick={compactNumber}
          />
        </Card>
        <Card title="Отток" description="удаления по неделям">
          <div className={styles.metric}>
            <strong>
              {data.totalRemovals ? Math.round((data.earlyRemovals / data.totalRemovals) * 100) : 0}
              %
            </strong>{' '}
            <span>
              удалений в первые 7 дней ({data.earlyRemovals} из {data.totalRemovals})
            </span>
          </div>
          <ColumnChart
            label="Удаления по неделям"
            buckets={data.churn}
            series={churnSeries}
            every={4}
          />
        </Card>
        <Card title="Промокоды" description="установки, оплаты и сумма">
          <div className={styles.tableScroll}>
            <table className={styles.table} aria-label="Статистика промокодов партнёров">
              <thead>
                <tr>
                  <th scope="col">Код</th>
                  <th scope="col">Партнёр</th>
                  <th scope="col">Аккаунтов</th>
                  <th scope="col">Оплат</th>
                  <th scope="col">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {data.promoStats.map(({ promo, partner, clients, payments, revenue }) => (
                  <tr key={promo}>
                    <th scope="row">{promo}</th>
                    <td>{partnerLabel(partner)}</td>
                    <td>{clients}</td>
                    <td>{payments}</td>
                    <td>{money(revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
