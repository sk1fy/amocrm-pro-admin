import { cellText, money } from './DemoSession'
import type { DemoRow } from './fixtures'
import { dateLabel } from './fixtures'
import type { Partner } from './partnerDirectory'
import { partnerWidgets } from './partnerDirectory'
import type { WidgetTier } from './sections'

export const defaultCabinetPartner = 'directory-1'
export const cabinetProPrice = 20000

const referenceInstallDates: Record<string, string> = {
  '31421329': '2026-11-04',
  '31642103': '2026-11-01',
  '30467412': '2026-10-28',
  '30653106': '2026-08-23',
  '30025824': '2026-06-09',
}

export const cabinetPromoClients = [
  {
    id: '31421329',
    date: '2026-11-04',
    name: 'Сергей',
    phone: '+7 (000) 100-01-01',
    widget: 'Сделки клиента',
    code: 'AMO10',
  },
  {
    id: '31642103',
    date: '2026-11-01',
    name: 'Игорь',
    phone: '+7 (000) 100-01-02',
    widget: 'Закрытие задачи с результатом',
    code: 'OLEG-CRM',
  },
  {
    id: '30467412',
    date: '2026-10-28',
    name: 'Никита',
    phone: '+7 (000) 100-01-03',
    widget: 'Сделки клиента',
    code: 'AMO10',
  },
  {
    id: '30364700',
    date: '2026-09-15',
    name: 'Роман',
    phone: '+7 (000) 100-01-04',
    widget: 'Копирование в один клик',
    code: 'AMO10',
  },
]

export type CabinetInstall = {
  id: string
  account: string
  name: string
  installed: string
  until: string
  tier?: WidgetTier
  coverage: string
  paid: boolean
  tested: boolean
}

export type CabinetRenewal = Pick<CabinetInstall, 'until' | 'coverage' | 'paid' | 'tested'>

export type CabinetOrder = {
  id: string
  target: string
  title: string
  until: string
  price: number
  bonus: number
  method: 'invoice' | 'card'
  state: 'open' | 'paid' | 'cancelled'
}

function isWidgetTier(value: string | undefined): value is WidgetTier {
  return value === 'FREE' || value === 'TOP' || value === 'PRO'
}

function legacyInstall(row: DemoRow, account: string): CabinetInstall {
  const widget = row.cells[1]
  const tier = typeof widget === 'object' ? widget.line : undefined
  const until = row.paidUntil ? cellText(row.paidUntil) : ''
  return {
    id: row.id,
    account,
    name: cellText(widget),
    installed: row.date ?? '',
    until: /^\d{2}\.\d{2}\.\d{4}$/.test(until) ? until.split('.').reverse().join('-') : '',
    tier: isWidgetTier(tier) ? tier : undefined,
    coverage: tier === 'FREE' ? 'бесплатный' : '',
    paid: false,
    tested: false,
  }
}

const freeInstalls: CabinetInstall[] = [
  {
    id: '30160243-Возраст сделки',
    account: '30160243',
    name: 'Возраст сделки',
    installed: '2026-07-31',
    until: '2036-07-31',
    tier: 'FREE',
    coverage: 'бесплатный',
    paid: false,
    tested: false,
  },
  {
    id: '30330441-Возраст сделки',
    account: '30330441',
    name: 'Возраст сделки',
    installed: '2026-06-17',
    until: '2036-06-17',
    tier: 'FREE',
    coverage: 'бесплатный',
    paid: false,
    tested: false,
  },
]

export function cabinetInstallations(partner: Partner, rows: DemoRow[]) {
  const owns = (account: string) => partner.accounts.includes(account)
  const snapshots = partnerWidgets.flatMap(
    ([index, account, name, until, coverage]): CabinetInstall[] =>
      partner.id === `directory-${index}` && owns(account)
        ? [
            {
              id: `${account}-${name}`,
              account,
              name,
              installed: index === 1 ? (referenceInstallDates[account] ?? '') : '',
              until,
              tier: 'TOP',
              coverage,
              paid: !coverage.startsWith('тест'),
              tested: false,
            },
          ]
        : [],
  )
  const free =
    partner.id === defaultCabinetPartner ? freeInstalls.filter(({ account }) => owns(account)) : []
  const legacy = rows.flatMap((row) =>
    row.client && owns(row.client) ? [legacyInstall(row, row.client)] : [],
  )
  return [...snapshots, ...free, ...legacy]
    .map((install) => ({ ...install, ...partner.cabinetRenewals?.[install.id] }))
    .sort((left, right) => right.installed.localeCompare(left.installed))
}

export function requiresPartnerRequest(install: CabinetInstall) {
  return install.account === '31421329' || install.account === '30025824'
}

export const cabinetPrice = (install: CabinetInstall) => (install.paid ? 6000 : 5000)

export function cabinetHeldBonuses(partner: Partner) {
  return (partner.cabinetOrders ?? [])
    .filter(({ state }) => state === 'open')
    .reduce((sum, order) => sum + order.bonus, 0)
}

export function cabinetDatePlus(date: string, days: number) {
  const result = new Date(date + 'T00:00:00Z')
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

export function cabinetYearPlus(date: string) {
  const result = new Date(date + 'T00:00:00Z')
  const month = result.getUTCMonth()
  result.setUTCFullYear(result.getUTCFullYear() + 1)
  if (result.getUTCMonth() !== month) result.setUTCDate(0)
  return result.toISOString().slice(0, 10)
}

export function createCabinetOrder(
  partner: Partner,
  draft: Omit<CabinetOrder, 'id' | 'state'>,
  date: string,
) {
  const orders = partner.cabinetOrders ?? []
  if (
    !Number.isSafeInteger(draft.bonus) ||
    !Number.isSafeInteger(draft.price) ||
    draft.price <= 0 ||
    draft.bonus < 0 ||
    draft.bonus > Math.min(draft.price, partner.bonus - cabinetHeldBonuses(partner)) ||
    orders.some(({ target, state }) => target === draft.target && state === 'open')
  )
    return partner
  const id = `ПК-${orders.length + 1}`
  const next = { ...partner, cabinetOrders: [{ ...draft, id, state: 'open' as const }, ...orders] }
  return draft.bonus === draft.price ? completeCabinetOrder(next, id, date) : next
}

export function cancelCabinetOrder(partner: Partner, id: string): Partner {
  if (!partner.cabinetOrders?.some((order) => order.id === id && order.state === 'open'))
    return partner
  return {
    ...partner,
    cabinetOrders: partner.cabinetOrders.map((order) =>
      order.id === id ? { ...order, state: 'cancelled' } : order,
    ),
  }
}

export function completeCabinetOrder(partner: Partner, id: string, date: string): Partner {
  const orders = partner.cabinetOrders ?? []
  const order = orders.find((entry) => entry.id === id && entry.state === 'open')
  if (!order || order.bonus > partner.bonus) return partner
  const { target, title, until, bonus, price } = order
  const cabinetOrders = orders.map((record) =>
    record.id === order.id ? { ...record, state: 'paid' as const } : record,
  )
  return {
    ...partner,
    cabinetOrders,
    bonus: partner.bonus - bonus,
    operations: [
      `${dateLabel(date)} · ${title} · ${money(price - bonus)} в демо · ${money(bonus)} бонусами`,
      ...partner.operations,
    ],
    ...(target === 'pro'
      ? { proTill: until, proTrial: false }
      : {
          lastWidgetPayment: date,
          cabinetRenewals: {
            ...partner.cabinetRenewals,
            [target]: { until, coverage: 'оплачен партнёром', paid: true, tested: false },
          },
        }),
  }
}
