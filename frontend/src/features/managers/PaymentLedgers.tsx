import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { DetailDrawer } from '../../components/DetailDrawer'
import { demoClients, findDemoClient } from './clientDirectory'
import { cellText, money, today, useDemo } from './DemoSession'
import { dateLabel } from './fixtures'
import { usePartners } from './Partners'
import { snapshotBonuses, snapshotSales } from './paymentFixtures'
import type { Receipt } from './paymentRegistry'
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
import { saleMeans, saleSources, type PaymentFilters } from './paymentsSearch'
import styles from './PaymentsBoard.module.css'

type Props = { filters: PaymentFilters; change: ChangeFilters; records: Receipt[] }

type Sale = (typeof snapshotSales)[number]
const defaultSale = {
  cashId: '',
  balance: 0,
  gift: '',
  discount: '',
  partner: '',
  from: '',
  deal: '',
  kind: '',
  users: 0,
} as const
const matchesQuery = (text: string, query: string) =>
  text.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))

export function WidgetPayments({ filters, change }: Props) {
  const { state } = useDemo()
  const added = state.invoices
    .filter(
      (invoice) =>
        invoice.state === 'paid' &&
        invoice.receipt &&
        (invoice.installation || invoice.kind === 'widget' || invoice.kind === 'sub'),
    )
    .map((invoice): Sale => {
      const install = state.rows.find((row) => row.id === invoice.installation)
      return {
        ...defaultSale,
        id: invoice.id,
        client: invoice.client,
        date: invoice.paidAt ?? invoice.date,
        product: install ? cellText(install.cells[1]) : invoice.description,
        source: 'admin',
        money: invoice.amount - invoice.bonus,
        bonus: invoice.bonus,
        price: invoice.amount,
        to: invoice.until ?? '',
        deal: invoice.deal ?? '',
      }
    })
  const manual = state.events
    .filter((event) => event.title === 'Виджет продлён')
    .map(
      (event): Sale => ({
        ...defaultSale,
        id: event.id,
        date: event.date,
        client: event.client,
        product: event.details,
        source: 'admin',
        money: 0,
        bonus: 0,
        price: 0,
        to: '',
      }),
    )
  const period = [...added, ...manual, ...snapshotSales].filter((sale) =>
    receiptInPeriod(sale, filters),
  )
  const totals = period.reduce(
    (values, sale) => ({
      price: values.price + sale.price,
      money: values.money + sale.money,
      bonus: values.bonus + sale.bonus,
      balance: values.balance + sale.balance,
      gift: values.gift + Number(!!sale.gift),
    }),
    { price: 0, money: 0, bonus: 0, balance: 0, gift: 0 },
  )
  const visible = period
    .filter((sale) => {
      const client = findDemoClient(sale.client)
      return (
        (!filters.source || filters.source === sale.source) &&
        (!filters.means || Boolean(sale[filters.means])) &&
        matchesQuery(
          [sale.product, client?.domain, sale.client, sale.partner, sale.deal].join(' '),
          filters.q,
        )
      )
    })
    .sort((a, b) => b.date.localeCompare(a.date))
  return (
    <>
      <div className={styles.summaries}>
        <PaymentSummary
          value={money(totals.price)}
          label="продано по прайсу"
          note={`${period.filter((r) => r.money || r.bonus || r.balance).length} оплат`}
        />
        <PaymentSummary
          value={money(totals.money)}
          label="оплачено деньгами"
          note="карта и расчётный счёт"
          onClick={() => change({ means: filters.means === 'money' ? '' : 'money' })}
          active={filters.means === 'money'}
        />
        <PaymentSummary
          value={money(totals.bonus)}
          label="бонусами клиентов"
          onClick={() => change({ means: filters.means === 'bonus' ? '' : 'bonus' })}
          active={filters.means === 'bonus'}
        />
        <PaymentSummary
          value={money(totals.balance)}
          label="бонусами партнёров"
          note="скидка с бонусного баланса"
          onClick={() => change({ means: filters.means === 'balance' ? '' : 'balance' })}
          active={filters.means === 'balance'}
        />
        <PaymentSummary
          value={totals.gift}
          label="подарков"
          note="«Наш клиент», бонус TOP, тест"
          onClick={() => change({ means: filters.means === 'gift' ? '' : 'gift' })}
          active={filters.means === 'gift'}
        />
      </div>
      <PaymentFiltersBar
        filters={filters}
        change={change}
        label="Поиск по оплатам виджетов"
        placeholder="Виджет, аккаунт, партнёр, сделка"
      >
        <PaymentSelect
          title="Откуда"
          value={filters.source}
          options={saleSources}
          change={(source) => change({ source })}
        />
        <PaymentSelect
          title="Чем оплачено"
          value={filters.means}
          options={saleMeans}
          change={(means) => change({ means })}
        />
      </PaymentFiltersBar>
      <PaymentTable
        columns={[
          'Дата',
          'Аккаунт',
          'Что',
          'Откуда',
          'Чем оплачено',
          'По прайсу',
          'Скидка',
          'Срок',
          'Сделка',
        ]}
      >
        {visible.map((sale) => {
          const client = findDemoClient(sale.client)
          return (
            <tr key={sale.id}>
              <td>{dateLabel(sale.date)}</td>
              <td>
                {client ? (
                  <>
                    <ClientPaymentLink client={client.id}>{client.domain}</ClientPaymentLink>
                    <small>ID {client.id}</small>
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td>
                {sale.product}
                {sale.kind && (
                  <small>{sale.kind === 'first' ? 'первая оплата' : 'продление'}</small>
                )}
              </td>
              <td>
                {saleSources[sale.source]}
                {sale.partner && <small>{sale.partner}</small>}
              </td>
              <td>
                {sale.money > 0 && <span className={styles.tag}>{money(sale.money)}</span>}
                {sale.bonus > 0 && <span className={styles.tag}>Бонусы {money(sale.bonus)}</span>}
                {sale.balance > 0 && (
                  <span className={styles.tag}>Баланс партнёра {money(sale.balance)}</span>
                )}
                {sale.gift && <span className={styles.tag}>Подарок: {sale.gift}</span>}
                {!sale.money && !sale.bonus && !sale.balance && !sale.gift && 'Без денег'}
              </td>
              <td>{money(sale.price)}</td>
              <td>{sale.discount || '—'}</td>
              <td>
                {sale.to
                  ? `${sale.from ? dateLabel(sale.from) + ' → ' : 'до '}${dateLabel(sale.to)}`
                  : '—'}
              </td>
              <td>{sale.deal ? `№${sale.deal}` : '—'}</td>
            </tr>
          )
        })}
        {!visible.length && (
          <EmptyPaymentRows columns={9}>Ничего не нашлось. Измените фильтры.</EmptyPaymentRows>
        )}
      </PaymentTable>
    </>
  )
}

export function PartnerLedger({ filters, change, records }: Props) {
  const [partners] = usePartners()
  const cash = new Map<string, number>()
  const period = records.filter(
    (record) => record.state === 'paid' && record.partner && receiptInPeriod(record, filters),
  )
  for (const record of period)
    cash.set(record.partner, (cash.get(record.partner) ?? 0) + record.amount)
  const totalBalance = partners.reduce((sum, partner) => sum + partner.bonus, 0)
  const visible = partners
    .filter(
      (partner) =>
        (filters.q.trim() ||
          partner.bonus ||
          partner.operations.length ||
          cash.has(partner.name)) &&
        matchesQuery(`${partner.name} ${partner.legal}`, filters.q),
    )
    .sort((a, b) => b.bonus - a.bonus)
  const operations = visible.flatMap((partner) =>
    partner.operations.map((description, i) => ({
      key: `${partner.id}:${i}`,
      partner,
      description,
    })),
  )
  return (
    <>
      <div className={styles.summaries}>
        <PaymentSummary
          value={money(period.reduce((sum, r) => sum + r.amount, 0))}
          label="оплачено деньгами"
          note="за период · счета и карты партнёров"
        />
        <PaymentSummary
          value={money(totalBalance)}
          label="бонусов на балансах"
          note="доступно партнёрам"
        />
      </div>
      <div className={styles.ledgerTabs} role="group" aria-label="Балансы партнёров">
        <button
          type="button"
          aria-pressed={filters.ledger === 'balances'}
          onClick={() => change({ ledger: 'balances' })}
        >
          Балансы
        </button>
        <button
          type="button"
          aria-pressed={filters.ledger === 'operations'}
          onClick={() => change({ ledger: 'operations' })}
        >
          Журнал операций
        </button>
      </div>
      <PaymentFiltersBar
        filters={filters}
        change={change}
        label="Поиск партнёра"
        placeholder="Партнёр: название или реквизиты"
      />
      {filters.ledger === 'balances' ? (
        <PaymentTable columns={['Партнёр', 'Деньгами за период', 'Бонусный баланс', 'Операции']}>
          {visible.map((partner) => (
            <tr key={partner.id}>
              <td>
                {partner.name}
                {partner.legal && <small>{partner.legal}</small>}
              </td>
              <td>{money(cash.get(partner.name) ?? 0)}</td>
              <td>{money(partner.bonus)}</td>
              <td>
                {partner.operations.length ? (
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => change({ q: partner.name, ledger: 'operations' })}
                  >
                    {partner.operations.length}
                  </button>
                ) : (
                  '0'
                )}
              </td>
            </tr>
          ))}
          {!visible.length && (
            <EmptyPaymentRows columns={4}>Ничего не нашлось. Измените фильтры.</EmptyPaymentRows>
          )}
        </PaymentTable>
      ) : (
        <PaymentTable columns={['Партнёр', 'Операция']}>
          {operations.map(({ key, partner, description }) => (
            <tr key={key}>
              <td>{partner.name}</td>
              <td>{description}</td>
            </tr>
          ))}
          {!operations.length && (
            <EmptyPaymentRows columns={2}>Операций с бонусами пока нет.</EmptyPaymentRows>
          )}
        </PaymentTable>
      )}
    </>
  )
}

export function BonusLedger({ filters, change }: Props) {
  const { state } = useDemo()
  const [details, showDetails] = useState('')
  const rows = demoClients.flatMap((client) => {
    const account = state.accounts[client.id]
    if (!account) return []
    const seed = snapshotBonuses.get(client.id)
    const isSnapshot = seed !== undefined
    const changed =
      account.bonusHistory.length > 0 ||
      state.invoices.some(
        (invoice) => invoice.client === client.id && !invoice.snapshot && invoice.bonus > 0,
      )
    if (!isSnapshot && !changed && !(filters.q.trim() && account.bonus > 0)) return []
    const reserve = state.invoices
      .filter((invoice) => invoice.client === client.id && invoice.state === 'open')
      .reduce((x, invoice) => x + invoice.bonus, 0)
    const soon = Math.min(
      account.bonus,
      seed?.soon ??
        (Date.parse(account.bonusUntil) - Date.parse(today) <= 90 * 86400000 ? account.bonus : 0),
    )
    return [{ client, account, seed, reserve, soon }]
  })
  const burn = filters.tab === 'burn'
  const results = rows
    .filter(
      ({ client, soon }) =>
        (!burn || soon > 0) &&
        matchesQuery(`${client.domain} ${client.id} ${client.name}`, filters.q),
    )
    .sort((a, b) =>
      burn
        ? a.account.bonusUntil.localeCompare(b.account.bonusUntil)
        : b.account.bonus - a.account.bonus,
    )
  const selected = results.find((row) => row.client.id === details)
  return (
    <>
      <div className={styles.summaries}>
        <PaymentSummary
          value={money(rows.reduce((sum, r) => sum + r.account.bonus, 0))}
          label="доступно бонусов"
          note="на счетах клиентов"
        />
        <PaymentSummary
          value={money(rows.reduce((sum, r) => sum + r.reserve, 0))}
          label="зарезервировано"
          note="по неоплаченным счетам"
        />
        <PaymentSummary
          value={money(rows.reduce((sum, r) => sum + r.soon, 0))}
          label="сгорит за 90 дней"
          note={`${rows.filter((r) => r.soon > 0).length} клиентов`}
          active={burn}
          onClick={() => change({ tab: burn ? 'bonus' : 'burn' })}
        />
      </div>
      <PaymentFiltersBar
        filters={filters}
        change={change}
        hidePeriod
        label="Поиск по бонусам клиентов"
        placeholder="ID, поддомен или название клиента"
      />
      <PaymentTable
        columns={['Клиент', 'Доступно', 'Резерв', 'Сгорит за 90 дней', 'Ближайшее сгорание', '']}
      >
        {results.map(({ client, account, reserve, soon }) => (
          <tr key={client.id}>
            <td>
              <ClientPaymentLink client={client.id}>{client.domain}</ClientPaymentLink>
              <small>
                ID {client.id} · {client.name}
              </small>
            </td>
            <td>{money(account.bonus)}</td>
            <td>{money(reserve)}</td>
            <td>{money(soon)}</td>
            <td>{account.bonus ? dateLabel(account.bonusUntil) : '—'}</td>
            <td>
              <button type="button" onClick={() => showDetails(client.id)}>
                История
              </button>
            </td>
          </tr>
        ))}
        {!results.length && (
          <EmptyPaymentRows columns={6}>Ничего не нашлось. Измените фильтры.</EmptyPaymentRows>
        )}
      </PaymentTable>
      {selected && (
        <DetailDrawer
          title={`Бонусы: ${selected.client.domain}`}
          open
          onClose={() => showDetails('')}
        >
          {selected.seed && (
            <p>
              Начислено {money(selected.seed.earned)} · использовано {money(selected.seed.spent)}
            </p>
          )}
          <p>
            Доступно {money(selected.account.bonus)} · в резерве {money(selected.reserve)}
          </p>
          {selected.account.bonusHistory.map((amount, i) => (
            <p key={i}>
              {amount > 0 ? 'Начисление' : 'Списание'} {money(Math.abs(amount))}
            </p>
          ))}
          <Link
            to="/managers"
            search={(previous) => ({
              ...previous,
              section: 'payments',
              client: selected.client.id,
            })}
          >
            Открыть карточку клиента
          </Link>
        </DetailDrawer>
      )}
    </>
  )
}
