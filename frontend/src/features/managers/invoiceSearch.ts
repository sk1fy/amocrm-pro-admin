import type { InvoiceSeller } from './invoiceFixtures'

export const invoiceTabs = {
  wait: 'Ждём оплату',
  stale: 'Без движения 5+ дн.',
  paid: 'Оплачены',
  cancelled: 'Аннулированы',
  all: 'Все',
} as const

export type InvoiceTab = keyof typeof invoiceTabs

export type InvoiceFilters = {
  tab: InvoiceTab
  seller: InvoiceSeller | ''
  query: string
}

export const defaultInvoiceFilters: InvoiceFilters = { tab: 'wait', seller: '', query: '' }

export function parseInvoiceFilters(value: unknown): InvoiceFilters | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { tab, seller, query } = value as Record<string, unknown>
  return {
    tab: typeof tab === 'string' && Object.hasOwn(invoiceTabs, tab) ? (tab as InvoiceTab) : 'wait',
    seller: seller === 'sh' || seller === 'shv' ? seller : '',
    query: typeof query === 'string' ? query : '',
  }
}
