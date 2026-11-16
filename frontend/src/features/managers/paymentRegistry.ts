import type { DemoState } from './DemoSession'
import { snapshotReceipts } from './paymentFixtures'

export type Receipt = (typeof snapshotReceipts)[number]
export type ReceiptReviews = Record<string, { by: string; date: string } | null>
const snapshotNumbers = new Set(snapshotReceipts.map(({ number }) => number).filter(Boolean))

export function getReceipts(state: DemoState, reviews: ReceiptReviews): Receipt[] {
  const paidInvoices = state.invoices.filter((invoice) => invoice.state === 'paid')
  const matched = new Map(
    paidInvoices.flatMap((invoice) =>
      invoice.statementId ? [[invoice.statementId, invoice]] : [],
    ),
  )
  const archived = snapshotReceipts.map((record): Receipt => {
    const invoice = matched.get(record.id)
    const attribution = state.statementAttributions[record.id]
    if (invoice) {
      const number = invoice.number ?? invoice.id
      return {
        ...record,
        state: 'paid',
        client: invoice.client,
        number,
        vat: invoice.seller !== 'shv',
        doc: number,
        detail: invoice.description,
        deal: invoice.deal ?? '',
        source: invoice.receipt?.split(' · ')[1] ?? 'сервер',
      }
    }
    if (attribution) {
      return {
        ...record,
        client: attribution.client ?? '',
        partner: attribution.partner ?? '',
        state: 'paid',
        doc: 'ВЫП-' + record.id,
        source: attribution.by,
      }
    }
    return record
  })
  const added = paidInvoices.flatMap((invoice): Receipt[] => {
    const amount = invoice.amount - invoice.bonus
    const number = invoice.number ?? invoice.id
    if (
      amount <= 0 ||
      invoice.statementId ||
      snapshotNumbers.has(number) ||
      (invoice.legacy && !invoice.receipt)
    )
      return []
    const method = invoice.method ?? 'invoice'
    return [
      {
        id: 'invoice:' + invoice.id,
        date: invoice.paidAt ?? invoice.date,
        amount,
        method,
        state: 'paid',
        client: invoice.client,
        partner: '',
        partnerContact: '',
        detail: invoice.description,
        number,
        vat: invoice.seller !== 'shv',
        doc: method === 'invoice' || invoice.payerInn ? number : '',
        deal: invoice.deal ?? '',
        payer: invoice.payer ?? '',
        source: invoice.receipt?.split(' · ')[1] ?? invoice.by ?? 'сервер',
        reviewed: '',
        reviewDate: '',
      },
    ]
  })
  return [...archived, ...added]
    .map((record) => {
      if (!Object.hasOwn(reviews, record.id)) return record
      const review = reviews[record.id]
      return { ...record, reviewed: review?.by ?? '', reviewDate: review?.date ?? '' }
    })
    .sort(
      (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id, 'ru', { numeric: true }),
    )
}
