import { directoryDate } from './clientDirectory'
import { cellText, type DemoState } from './DemoSession'
import { snapshotSales } from './paymentFixtures'
import { getReceipts } from './paymentRegistry'
import { statisticsAccountPartners, statisticsInstallations } from './statisticsFixtures'
import type { StatisticsFilters } from './statisticsSearch'
import { widgetCatalog } from './widgetCatalog'

const widgetColors = ['#3b7be8', '#e08a00', '#169c8f', '#9b5de5']
export const statisticsWidgets = widgetCatalog.map(({ code, name, tier }, index) => ({
  code,
  name,
  tier,
  color: widgetColors[index],
}))

export type Bucket = {
  key: string
  label: string
  period: string
  values: number[]
}

type Dated = { date: string }
type Installation = (typeof statisticsInstallations)[number]
type Purchase = Pick<(typeof snapshotSales)[number], 'client' | 'date' | 'product' | 'money'>
type Trial = Installation & { purchase?: Purchase }

const day = 86_400_000
const weekCount = 26
const shortDateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'short', timeZone: 'UTC' })
const monthWithYearFormat = new Intl.DateTimeFormat('ru-RU', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

export function moveDate(date: string, days: number) {
  return new Date(Date.parse(date) + days * day).toISOString().slice(0, 10)
}

export function statisticsRange(filters: StatisticsFilters) {
  const upper = filters.to || directoryDate
  return { from: filters.from || moveDate(upper, 1 - filters.days), to: upper }
}

type Range = ReturnType<typeof statisticsRange>

function during(date: string, { from, to }: Range) {
  return date >= from && date <= to
}

function shortDate(date: string) {
  return shortDateFormat.format(new Date(date)).replace('.', '')
}

function getWeeks() {
  const weekDay = new Date(directoryDate).getUTCDay()
  const lastMonday = moveDate(directoryDate, -((weekDay + 6) % 7))
  return Array.from({ length: weekCount }, (_, index) =>
    moveDate(lastMonday, (index - weekCount + 1) * 7),
  )
}

function weekBuckets<T extends Dated>(
  rows: readonly T[],
  series: readonly ((item: T) => boolean)[] = [() => true],
): Bucket[] {
  return getWeeks().map((start) => {
    const end = moveDate(start, 6)
    const bucket = rows.filter(({ date }) => during(date, { from: start, to: end }))
    return {
      key: start,
      label: shortDate(start),
      period: `${shortDate(start)} — ${shortDate(end)}`,
      values: series.map((matches) => bucket.filter(matches).length),
    }
  })
}

function top<T>(rows: readonly T[], keyOf: (row: T) => number | string, valueOf = (_row: T) => 1) {
  const frequencies = new Map<string | number, number>()
  for (const row of rows) {
    const key = keyOf(row)
    if (key) frequencies.set(key, (frequencies.get(key) ?? 0) + valueOf(row))
  }
  return [...frequencies.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 10)
}

export function statisticsData(state: DemoState, filters: StatisticsFilters) {
  const range = statisticsRange(filters)
  const inPeriod = (date: string) => during(date, range)
  const validClient = (client: string) => state.accounts[client]?.owner !== 'Запрет работы'
  const installs = statisticsInstallations.filter(({ client }) => validClient(client))
  const first = installs.filter((installation) => installation.first)
  const firstByClient = new Map<string, Installation>()
  for (const item of installs) {
    const previous = firstByClient.get(item.client)
    if (!previous || item.date < previous.date) firstByClient.set(item.client, item)
  }
  const newAccounts = [...firstByClient.values()]
  const newAccountsInPeriod = newAccounts.filter(({ date }) => inPeriod(date))
  const widgetFromInvoice = new Map(state.rows.map((row) => [row.id, cellText(row.cells[1])]))
  const purchases: Purchase[] = [
    ...snapshotSales.filter((sale) => !sale.gift && validClient(sale.client)),
    ...state.invoices.flatMap((invoice): Purchase[] => {
      const product = invoice.installation && widgetFromInvoice.get(invoice.installation)
      if (invoice.state !== 'paid' || !invoice.receipt || !product || !validClient(invoice.client))
        return []
      return [
        {
          client: invoice.client,
          product,
          date: invoice.paidAt ?? invoice.date,
          money: invoice.amount - invoice.bonus,
        },
      ]
    }),
  ]
  const purchasesInPeriod = purchases.filter(({ date }) => inPeriod(date))
  const removals = installs.filter(({ removed }) => removed)
  const widgetRanks = statisticsWidgets
    .map((widget, index) => {
      const newInstalls = first.filter(
        (installation) => installation.widget === index && inPeriod(installation.date),
      )
      const ready = newInstalls.filter((installation) => !installation.waiting)
      return {
        ...widget,
        value: new Set(newInstalls.map((installation) => installation.client)).size,
        activation: ready.length
          ? Math.round(
              (ready.filter((installation) => installation.activated).length / ready.length) * 100,
            )
          : 0,
        paid: purchasesInPeriod.filter(({ product }) => product === widget.name).length,
        removed: removals.filter((item) => item.widget === index && inPeriod(item.removed)).length,
      }
    })
    .sort((left, right) => right.value - left.value)

  const partnerInstalls = installs.filter(({ partner, date }) => partner && inPeriod(date))
  const activatedByPartner = new Map<number, string>()
  for (const item of installs) {
    const previous = activatedByPartner.get(item.partner)
    if (item.partner && item.activated && (!previous || item.activated > previous))
      activatedByPartner.set(item.partner, item.activated)
  }
  const paidReceipts = getReceipts(state, {}).filter(({ state }) => state === 'paid')
  const trialCandidates = installs.filter(({ trialEnd, covered }) => trialEnd && !covered)
  const activeTrials: Trial[] = []
  const expiredTrials: Trial[] = []
  const paidTrials: Trial[] = []
  for (const trial of trialCandidates) {
    const product = statisticsWidgets[trial.widget].name
    const matching = purchases.filter(
      (item) => item.client === trial.client && item.product === product,
    )
    const firstCash = matching
      .filter((item) => item.money > 0)
      .sort((left, right) => left.date.localeCompare(right.date))[0]
    if (firstCash && inPeriod(firstCash.date)) paidTrials.push({ ...trial, purchase: firstCash })
    if (matching.length) continue
    if (!trial.removed && trial.trialEnd >= directoryDate) activeTrials.push(trial)
    if (trial.trialEnd < directoryDate && inPeriod(trial.trialEnd)) expiredTrials.push(trial)
  }

  const sortedActive = activeTrials.sort((left, right) =>
    left.trialEnd.localeCompare(right.trialEnd),
  )
  const months = Array.from({ length: 6 }, (_, index) => new Date(Date.UTC(2026, 5 + index, 1)))
  const revenue = months.map((date): Bucket => {
    const key = date.toISOString().slice(0, 7)
    const receipts = paidReceipts.filter((receipt) => receipt.date.startsWith(key))
    return {
      key,
      label: monthFormat.format(date).replace('.', ''),
      period: monthWithYearFormat.format(date),
      values: ['card', 'invoice'].map((method) =>
        receipts.reduce(
          (total, receipt) => total + (receipt.method === method ? receipt.amount : 0),
          0,
        ),
      ),
    }
  })
  const promoInstalls = installs.filter(({ promo }) => promo)
  const promoStats = [...new Map(promoInstalls.map(({ promo, partner }) => [promo, partner]))].map(
    ([promo, partner]) => {
      const clients = new Set(
        promoInstalls.filter((row) => row.promo === promo).map(({ client }) => client),
      )
      const sales = snapshotSales.filter(({ client, gift }) => clients.has(client) && !gift)
      return {
        promo,
        partner,
        clients: clients.size,
        payments: sales.length,
        revenue: sales.reduce((total, sale) => total + sale.money + sale.balance, 0),
      }
    },
  )

  return {
    range,
    widgetRanks,
    newAccountCount: newAccountsInPeriod.length,
    newAccountWeeks: weekBuckets(newAccounts),
    installationWeeks: weekBuckets(
      first,
      filters.split
        ? statisticsWidgets.map((_, index) => (row) => row.widget === index)
        : undefined,
    ),
    partnerAccountRanks: top(
      newAccountsInPeriod,
      ({ client }) => statisticsAccountPartners.get(client) ?? 0,
    ),
    partnerInstallationRanks: top(partnerInstalls, ({ partner }) => partner),
    partnerWidgetRanks: statisticsWidgets
      .map((widget, index) => ({
        ...widget,
        value: partnerInstalls.filter(({ widget }) => widget === index).length,
      }))
      .filter(({ value }) => value > 0)
      .sort((left, right) => right.value - left.value),
    partnerPayments: top(
      paidReceipts.filter((receipt) => inPeriod(receipt.date)),
      ({ partner }) => partner,
      ({ amount }) => amount,
    ),
    partnerActivations: [...activatedByPartner.entries()]
      .sort((left, right) => right[1].localeCompare(left[1]))
      .slice(0, 10),
    trials: {
      running: sortedActive,
      ending: sortedActive.filter(({ trialEnd }) => trialEnd <= moveDate(directoryDate, 7)),
      expired: expiredTrials.sort((left, right) => right.trialEnd.localeCompare(left.trialEnd)),
      paid: paidTrials.sort((left, right) =>
        (right.purchase?.date ?? '').localeCompare(left.purchase?.date ?? ''),
      ),
    },
    revenue,
    churn: weekBuckets(removals.map((item) => ({ date: item.removed }))),
    earlyRemovals: removals.filter((item) => item.removed <= moveDate(item.date, 7)).length,
    totalRemovals: removals.length,
    promoStats,
  }
}

export type StatisticsData = ReturnType<typeof statisticsData>
