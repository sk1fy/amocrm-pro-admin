export const paymentTabs = {
  money: 'Поступления',
  burn: 'Сгорают бонусы',
  sales: 'Оплаты виджетов',
  partners: 'Балансы партнёров',
  bonus: 'Бонусы клиентов',
} as const

export const paymentMethods = { card: 'Карта', invoice: 'Расчётный счёт' } as const
export const paymentStates = { paid: 'Оплачен', unmatched: 'Не разобран' } as const
export const reviewTabs = { new: 'Непроверенные', all: 'Все', done: 'Проверенные' } as const
export const saleSources = {
  widget: 'Виджет',
  deal: 'Сделка rakurscrm',
  cabinet: 'Кабинет партнёра',
  admin: 'Админка',
} as const
export const saleMeans = {
  money: 'Деньги',
  bonus: 'Бонусы клиента',
  balance: 'Бонусы партнёра',
  gift: 'Подарок',
} as const

export type PaymentFilters = {
  tab: keyof typeof paymentTabs
  review: keyof typeof reviewTabs
  method: keyof typeof paymentMethods | ''
  state: keyof typeof paymentStates | ''
  source: keyof typeof saleSources | ''
  means: keyof typeof saleMeans | ''
  from: string
  to: string
  q: string
  ledger: 'balances' | 'operations'
}

export const defaultPaymentFilters: PaymentFilters = {
  tab: 'money',
  review: 'new',
  method: '',
  state: '',
  source: '',
  means: '',
  from: '2026-10-07',
  to: '2026-11-06',
  q: '',
  ledger: 'balances',
}

function keyOf<T extends Record<string, string>>(value: unknown, options: T): keyof T | undefined {
  return typeof value === 'string' && Object.hasOwn(options, value) ? value : undefined
}

function dateFilter(value: unknown, fallback: string) {
  if (value === '') return value
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback
}

export function parsePaymentFilters(value: unknown): PaymentFilters | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const filters = value as Record<string, unknown>
  return {
    tab: keyOf(filters.tab, paymentTabs) ?? defaultPaymentFilters.tab,
    review: keyOf(filters.review, reviewTabs) ?? defaultPaymentFilters.review,
    method: keyOf(filters.method, paymentMethods) ?? '',
    state: keyOf(filters.state, paymentStates) ?? '',
    source: keyOf(filters.source, saleSources) ?? '',
    means: keyOf(filters.means, saleMeans) ?? '',
    from: dateFilter(filters.from, defaultPaymentFilters.from),
    to: dateFilter(filters.to, defaultPaymentFilters.to),
    q: typeof filters.q === 'string' ? filters.q : '',
    ledger: filters.ledger === 'operations' ? 'operations' : 'balances',
  }
}
