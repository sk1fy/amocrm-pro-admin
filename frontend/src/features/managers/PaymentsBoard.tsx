import { useMemo, useState, type ComponentProps } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { DetailDrawer } from '../../components/DetailDrawer'
import { useAccountDraft } from './AccountDrafts'
import { demoClients, findDemoClient } from './clientDirectory'
import { can, money, today, useDemo } from './DemoSession'
import { dateLabel } from './fixtures'
import { invoiceOutstanding } from './invoiceFixtures'
import { usePartners } from './Partners'
import { snapshotBonuses } from './paymentFixtures'
import { getReceipts, type Receipt, type ReceiptReviews } from './paymentRegistry'
import {
  defaultPaymentFilters,
  paymentMethods,
  paymentStates,
  paymentTabs,
  reviewTabs,
  type PaymentFilters,
} from './paymentsSearch'
import {
  ClientPaymentLink,
  EmptyPaymentRows,
  PaymentFiltersBar,
  PaymentSelect,
  PaymentSummary,
  PaymentTable,
  receiptInPeriod,
  type ChangeFilters,
} from './PaymentPrimitives'
import { BonusLedger, PartnerLedger, WidgetPayments } from './PaymentLedgers'
import styles from './PaymentsBoard.module.css'

function useReceipts() {
  const { actor, state } = useDemo()
  const [reviews, setReviews] = useAccountDraft<ReceiptReviews>('/paymentReviews', {})
  const records = useMemo(() => getReceipts(state, reviews), [state, reviews])
  return {
    records,
    check: (id: string, checked: boolean) => {
      if (!can(actor, 'pay') || !records.some((r) => r.id === id && r.state === 'paid')) return
      setReviews((current) => ({
        ...current,
        [id]: checked ? { by: actor.name, date: today } : null,
      }))
    },
  }
}

export function useUnreviewedPaymentCount() {
  const { records } = useReceipts()
  return records.filter((receipt) => !receipt.reviewed).length
}

function relativeDate(date: string) {
  const days = (Date.parse(defaultPaymentFilters.to) - Date.parse(date)) / 86400000
  if (days < 0) return dateLabel(date)
  if (days === 0) return 'сегодня'
  if (days === 1) return 'вчера'
  return `${days} ${new Intl.PluralRules('ru').select(days) === 'few' ? 'дня' : new Intl.PluralRules('ru').select(days) === 'one' ? 'день' : 'дней'} назад`
}

const fee = (amount: number) => Math.round(amount * 0.03)
const sum = (rows: readonly { amount: number }[]) =>
  rows.reduce((total, row) => total + row.amount, 0)

function Payer({ record, open }: { record: Receipt; open: () => void }) {
  const customer = findDemoClient(record.client)
  const company = customer ? `ООО «${customer.name.split(',')[0]}»` : ''
  if (record.partner) {
    return (
      <>
        <button type="button" className={styles.payer} onClick={open}>
          {record.partner}
        </button>
        <small>партнёр{record.partnerContact && ` · ${record.partnerContact}`}</small>
      </>
    )
  }
  if (customer) {
    return (
      <>
        <ClientPaymentLink client={record.client}>{customer.domain}</ClientPaymentLink>
        <small>
          {record.method === 'invoice' && company + ' · '}ID {record.client}
        </small>
      </>
    )
  }
  return (
    <>
      <span className={styles.payer}>{record.payer || '—'}</span>
      <small>плательщик не найден</small>
    </>
  )
}

type ReceiptDialog = { kind: 'reconcile' | 'document' | 'deal' | 'partner'; record: Receipt }

function ReceiptDocument({
  selection,
  onClose,
}: {
  selection: ReceiptDialog
  onClose: () => void
}) {
  const { record, kind } = selection
  const title =
    kind === 'document'
      ? `УПД ${record.doc}`
      : kind === 'deal'
        ? `Сделка №${record.deal}`
        : record.partner
  return (
    <DetailDrawer open title={title} onClose={onClose}>
      <p>{record.detail}</p>
      <p>
        {dateLabel(record.date)} · {money(record.amount)}
      </p>
      {record.number && (
        <p>
          Счёт {record.number} · {record.vat ? 'НДС 5%' : 'без НДС'}
        </p>
      )}
      {kind === 'document' && <p>Предпросмотр демо-документа</p>}
      {kind === 'partner' && <p>{record.partnerContact}</p>}
    </DetailDrawer>
  )
}

function ReconcileReceipt({ record, onClose }: { record: Receipt; onClose: () => void }) {
  const { state, dispatch } = useDemo()
  const [partners] = usePartners()
  const [target, setTarget] = useState<'invoice' | 'client' | 'partner'>('invoice')
  const [selection, setSelection] = useState('')
  const targetLabel =
    target === 'invoice' ? 'Счёт' : target === 'client' ? 'Аккаунт amoCRM' : 'Партнёр'
  const matchingInvoices = state.invoices.filter(
    (invoice) =>
      invoice.state === 'open' &&
      Math.round((invoice.amount - invoice.bonus) * 100) === record.amount * 100,
  )
  const options =
    target === 'invoice'
      ? matchingInvoices.map((invoice) => {
          const client = findDemoClient(invoice.client)
          return {
            id: invoice.id,
            label: `${invoice.number ?? invoice.id} · ${client?.domain ?? '—'} · ${invoice.description}`,
          }
        })
      : target === 'client'
        ? demoClients.map((client) => ({
            id: client.id,
            label: `${client.domain} · ID ${client.id}`,
          }))
        : partners.map((partner) => ({ id: partner.id, label: partner.name }))
  return (
    <DetailDrawer open title="Разобрать поступление" onClose={onClose}>
      <p>
        {money(record.amount)} · {dateLabel(record.date)} · {record.payer}
      </p>
      <p>{record.detail}. Укажите, к чему относится платёж.</p>
      <form
        className={styles.reconcileForm}
        onSubmit={(e) => {
          e.preventDefault()
          if (!selection) return
          if (target === 'invoice') {
            dispatch({ type: 'reconcileReceipt', id: selection, statementId: record.id })
          } else if (target === 'client') {
            dispatch({
              type: 'identifyReceipt',
              statementId: record.id,
              target: { client: selection },
            })
          } else {
            const partner = partners.find((value) => value.id === selection)
            if (!partner) return
            dispatch({
              type: 'identifyReceipt',
              statementId: record.id,
              target: { partner: partner.name },
            })
          }
          onClose()
        }}
      >
        <label>
          Назначение
          <select
            aria-label="Назначение"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value as typeof target)
              setSelection('')
            }}
          >
            <option value="invoice">Закрыть неоплаченный счёт</option>
            <option value="client">Записать на аккаунт без счёта</option>
            <option value="partner">Записать на партнёра без счёта</option>
          </select>
        </label>
        <label>
          {targetLabel}
          <select
            aria-label={targetLabel}
            value={selection}
            required
            onChange={(e) => setSelection(e.target.value)}
          >
            <option value="">
              {options.length ? 'Выберите' : 'Нет неоплаченных счетов на эту сумму'}
            </option>
            {options.map(({ id, label }) => (
              <option value={id} key={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p>
          {target === 'invoice'
            ? 'Совпадающий по сумме счёт будет закрыт. Поступление попадёт в выручку один раз.'
            : 'Поступление будет отнесено к выбранному плательщику. Бонусы и сроки не меняются.'}
        </p>
        <div className={styles.formActions}>
          <button type="button" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" data-variant="primary" disabled={!selection}>
            {target === 'invoice' ? 'Закрыть счёт' : 'Записать деньги'}
          </button>
        </div>
      </form>
    </DetailDrawer>
  )
}

function CashReceipts({
  records,
  check,
  filters,
  change,
}: ReturnType<typeof useReceipts> & { filters: PaymentFilters; change: ChangeFilters }) {
  const { state } = useDemo()
  const [selection, setSelection] = useState<ReceiptDialog | null>(null)
  const close = () => setSelection(null)
  const pending = records.filter((r) => !r.reviewed)
  const period = records.filter((row) => receiptInPeriod(row, filters))
  const base = filters.review === 'new' ? records : period
  const paid = period.filter((r) => r.state === 'paid')
  const unmatched = records.filter((r) => r.state === 'unmatched')
  const cardAmount = sum(paid.filter((r) => r.method === 'card'))
  const bankAmount = sum(paid.filter((r) => r.method === 'invoice'))
  const vat = Math.round((sum(paid.filter((r) => r.vat)) * 5) / 105)
  const { amount: outstanding, count: openCount } = invoiceOutstanding(state.invoices)
  const q = filters.q.trim().toLocaleLowerCase('ru')
  const visible = base.filter((r) => {
    if (filters.review === 'new' && r.reviewed) return false
    if (filters.review === 'done' && !r.reviewed) return false
    if (filters.method && r.method !== filters.method) return false
    if (filters.state && r.state !== filters.state) return false
    const customer = findDemoClient(r.client)
    return [
      r.detail,
      r.number,
      r.doc,
      r.deal,
      r.payer,
      r.client,
      r.partner,
      customer?.domain,
      customer?.name,
    ]
      .join(' ')
      .toLocaleLowerCase('ru')
      .includes(q)
  })
  const tabs = {
    new: pending.length,
    all: base.length,
    done: base.filter((record) => record.reviewed).length,
  }
  return (
    <>
      <div className={styles.summaries}>
        <PaymentSummary
          value={money(cardAmount + bankAmount)}
          label="поступило денег"
          note="за период"
        />
        <PaymentSummary
          value={money(cardAmount)}
          label="картой (эквайринг)"
          note={`≈ комиссия ${money(fee(cardAmount))} · оценка 3%, дошло ≈ ${money(cardAmount - fee(cardAmount))}`}
          onClick={() => change({ method: filters.method === 'card' ? '' : 'card' })}
          active={filters.method === 'card'}
        />
        <PaymentSummary
          value={money(bankAmount)}
          label="на расчётный счёт"
          note="по счетам · закрывающие — УПД"
          onClick={() => change({ method: filters.method === 'invoice' ? '' : 'invoice' })}
          active={filters.method === 'invoice'}
        />
        <Link
          className={styles.summary}
          to="/managers"
          search={{ section: 'invoices', client: undefined }}
        >
          <strong>{money(outstanding)}</strong>
          <span>ждём по счетам</span>
          <small>{openCount} счетов · список в «Счетах» →</small>
        </Link>
        <PaymentSummary
          value={money(vat)}
          label="НДС 5% в поступлениях"
          note="там, где НДС есть в счёте или чеке"
        />
        <PaymentSummary
          value={`${unmatched.length} · ${money(sum(unmatched))}`}
          label="не разобраны"
          note={unmatched.length ? 'деньги пришли, но непонятно чьи' : 'всё разобрано'}
          warning={unmatched.length > 0}
          active={filters.state === 'unmatched'}
          onClick={() => change({ state: filters.state === 'unmatched' ? '' : 'unmatched' })}
        />
      </div>
      <div className={styles.reviewTabs} role="group" aria-label="Проверка поступлений">
        {(Object.keys(reviewTabs) as (keyof typeof reviewTabs)[]).map((tab) => (
          <button
            type="button"
            key={tab}
            aria-pressed={tab === filters.review}
            onClick={() => change({ review: tab })}
          >
            {reviewTabs[tab]} <span className={styles.badge}>{tabs[tab]}</span>
          </button>
        ))}
      </div>
      <PaymentFiltersBar
        filters={filters}
        change={change}
        label="Поиск по поступлениям"
        placeholder="Аккаунт, партнёр, № счёта или сделки"
      >
        <PaymentSelect
          title="Способ"
          value={filters.method}
          options={paymentMethods}
          change={(method) => change({ method })}
        />
        <PaymentSelect
          title="Статус"
          value={filters.state}
          options={paymentStates}
          change={(state) => change({ state })}
        />
      </PaymentFiltersBar>
      <div className={styles.cashTable}>
        <PaymentTable
          columns={[
            'Дата',
            'Сумма',
            'Плательщик',
            'За что',
            'Статус',
            'Счёт · документы · сделка',
            '',
          ]}
        >
          {visible.map((record) => (
            <tr key={record.id}>
              <td>
                {dateLabel(record.date)}
                <small>{relativeDate(record.date)}</small>
              </td>
              <td>
                <span className={styles.amount}>{money(record.amount)}</span>
                <small>
                  {record.method === 'card'
                    ? `картой · ≈ −${money(fee(record.amount))} комиссия`
                    : 'на р/с'}
                </small>
              </td>
              <td>
                <Payer record={record} open={() => setSelection({ kind: 'partner', record })} />
              </td>
              <td>{record.detail}</td>
              <td>
                <span className={styles.pill} data-state={record.state}>
                  {paymentStates[record.state]}
                </span>
                <small>{record.source}</small>
              </td>
              <td className={styles.documents}>
                <span>
                  {record.method === 'card'
                    ? 'чек от эквайринга'
                    : `счёт ${record.number || '—'} · ${record.vat ? 'НДС 5%' : 'без НДС'}`}
                </span>
                {record.doc && (
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => setSelection({ kind: 'document', record })}
                  >
                    УПД {record.doc} ↓
                  </button>
                )}
                {record.state === 'unmatched' && <small>УПД — после разбора</small>}
                {record.deal && (
                  <span>
                    сделка{' '}
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={() => setSelection({ kind: 'deal', record })}
                    >
                      №{record.deal} ↗
                    </button>
                  </span>
                )}
              </td>
              <td>
                {record.state === 'unmatched' ? (
                  <button
                    type="button"
                    data-variant="primary"
                    onClick={() => setSelection({ kind: 'reconcile', record })}
                  >
                    Разобрать
                  </button>
                ) : record.reviewed ? (
                  <>
                    <small>
                      {record.reviewed} · {dateLabel(record.reviewDate)}
                    </small>
                    <button type="button" onClick={() => check(record.id, false)}>
                      Вернуть
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    data-variant="primary"
                    onClick={() => check(record.id, true)}
                  >
                    Проверен
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!visible.length && (
            <EmptyPaymentRows columns={7}>
              {filters.review === 'new' && !pending.length
                ? 'Все поступления проверены.'
                : 'Ничего не нашлось. Измените фильтры.'}
            </EmptyPaymentRows>
          )}
        </PaymentTable>
      </div>
      {selection?.kind === 'reconcile' ? (
        <ReconcileReceipt key={selection.record.id} record={selection.record} onClose={close} />
      ) : (
        selection && <ReceiptDocument selection={selection} onClose={close} />
      )}
    </>
  )
}

export function PaymentsBoard() {
  const { paymentFilters = defaultPaymentFilters } = useSearch({ from: '/managers' })
  const navigate = useNavigate({ from: '/managers' })
  const { state } = useDemo()
  const receipts = useReceipts()
  const update = (patch: Partial<PaymentFilters>) =>
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, paymentFilters: { ...paymentFilters, ...patch } }),
    })
  const common: ComponentProps<typeof WidgetPayments> = {
    filters: paymentFilters,
    change: update,
    records: receipts.records,
  }
  const moneyCount = receipts.records.filter((record) => !record.reviewed).length
  const burnCount = [...snapshotBonuses].filter(
    ([client, record]) => record.soon > 0 && state.accounts[client]?.bonus > 0,
  ).length
  return (
    <section className={styles.board} aria-labelledby="payments-title">
      <header>
        <h1 id="payments-title">Оплаты</h1>
        <p className={styles.description}>
          Живые деньги (карта и расчётный счёт) и то, чем оплачены виджеты, — в разных вкладках,
          чтобы выручка не задвоилась: бонусы клиентов и бонусный баланс партнёров — скидка. В
          выручку идёт только то, что оплачено картой или по счёту.
        </p>
      </header>
      <div className={styles.tabs} role="group" aria-label="Разделы оплат">
        {(Object.keys(paymentTabs) as (keyof typeof paymentTabs)[]).map((tab) => (
          <button
            type="button"
            key={tab}
            aria-pressed={tab === paymentFilters.tab}
            onClick={() => update({ ...defaultPaymentFilters, tab })}
          >
            {paymentTabs[tab]}
            {tab === 'money' && <span className={styles.badge}>{moneyCount}</span>}
            {tab === 'burn' && burnCount > 0 && (
              <span data-tone="warning" className={styles.badge}>
                {burnCount}
              </span>
            )}
          </button>
        ))}
      </div>
      {paymentFilters.tab === 'money' ? (
        <CashReceipts {...receipts} filters={paymentFilters} change={update} />
      ) : null}
      {paymentFilters.tab === 'sales' ? <WidgetPayments {...common} /> : null}
      {paymentFilters.tab === 'partners' ? <PartnerLedger {...common} /> : null}
      {paymentFilters.tab === 'burn' || paymentFilters.tab === 'bonus' ? (
        <BonusLedger {...common} />
      ) : null}
    </section>
  )
}
