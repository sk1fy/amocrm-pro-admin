import { useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { DetailDrawer } from '../../components/DetailDrawer'
import { can, money, today, useDemo, type Invoice } from './DemoSession'
import { CopyInvoiceLink, InvoiceForm } from './Finance'
import { findDemoClient } from './clientDirectory'
import { dateLabel } from './fixtures'
import {
  invoiceAge,
  invoiceCash,
  invoiceCount,
  invoiceKinds,
  invoiceSellers,
  isInvoiceStale,
} from './invoiceFixtures'
import {
  defaultInvoiceFilters,
  invoiceTabs,
  type InvoiceFilters,
  type InvoiceTab,
} from './invoiceSearch'
import styles from './InvoicesBoard.module.css'

function matchesTab(invoice: Invoice, tab: InvoiceTab) {
  switch (tab) {
    case 'wait':
      return invoice.state === 'open'
    case 'stale':
      return isInvoiceStale(invoice, today)
    case 'paid':
      return invoice.state === 'paid'
    case 'cancelled':
      return invoice.state === 'cancelled'
    case 'all':
      return true
  }
}

function matchesQuery(invoice: Invoice, query: string) {
  const client = findDemoClient(invoice.client)
  return [
    invoice.number,
    invoice.description,
    invoice.client,
    client?.name,
    client?.domain,
    invoice.deal,
    invoice.by,
    invoice.payer,
    invoice.payerInn,
  ]
    .join(' ')
    .toLocaleLowerCase('ru')
    .includes(query)
}

const ago = new Intl.RelativeTimeFormat('ru', { numeric: 'always' })

function relativeDay(age: number) {
  if (age === 0) return 'сегодня'
  if (age === 1) return 'вчера'
  return ago.format(-age, 'day')
}

function InvoiceStatus({ invoice }: { invoice: Invoice }) {
  const { state, date, paidAt, method, opened, cardUntil, snapshot } = invoice
  if (state === 'paid')
    return (
      <>
        <span className={styles.pill} data-tone="green">
          Оплачен{paidAt ? ' ' + dateLabel(paidAt).slice(0, 5) : ''}
        </span>
        <small>{method === 'card' ? 'картой' : 'по счёту'}</small>
      </>
    )
  if (state === 'cancelled')
    return (
      <span className={styles.pill} data-tone="gray">
        Аннулирован
      </span>
    )
  if (cardUntil)
    return (
      <>
        <span className={styles.pill} data-tone="blue">
          ссылка на карту
        </span>
        <small>живёт до {cardUntil}</small>
      </>
    )
  if (opened)
    return (
      <>
        <span className={styles.pill} data-tone="blue">
          клиент открыл
        </span>
        <small data-stale={isInvoiceStale(invoice, today)}>
          {dateLabel(opened)} · {relativeDay(invoiceAge(invoice, opened, today))}
        </small>
      </>
    )
  return (
    <>
      <span className={styles.pill} data-tone="amber">
        {snapshot ? 'не открывал' : 'Ждём оплату'}
      </span>
      <small data-stale={isInvoiceStale(invoice, today)}>
        выставлен {relativeDay(invoiceAge(invoice, date, today))}
      </small>
    </>
  )
}

const downloadsPlural = new Intl.PluralRules('ru')

export function InvoicesBoard() {
  const { state, actor, dispatch, focusInvoice } = useDemo()
  const { invoiceFilters = defaultInvoiceFilters } = useSearch({ from: '/managers' })
  const navigate = useNavigate({ from: '/managers' })
  const [create, setCreate] = useState(false)
  const [confirmId, setConfirmId] = useState('')
  const [message, setMessage] = useState('')
  const writable = can(actor, 'pay')
  const { tab, seller, query } = invoiceFilters
  const term = query.trim().toLocaleLowerCase('ru')
  const current = state.invoices.filter((invoice) => !invoice.legacy)
  const wait = current.filter((invoice) => invoice.state === 'open')
  const stale = current.filter((invoice) => isInvoiceStale(invoice, today))
  const paid30 = current.filter(
    (invoice) =>
      invoice.state === 'paid' && invoiceAge(invoice, invoice.paidAt ?? invoice.date, today) <= 30,
  )
  const rows = (term ? state.invoices : current).filter(
    (invoice) =>
      matchesTab(invoice, tab) &&
      (!seller || invoice.seller === seller) &&
      matchesQuery(invoice, term),
  )

  function setFilters(next: Partial<InvoiceFilters>, replace = false) {
    setConfirmId('')
    void navigate({
      search: (previous) => ({ ...previous, invoiceFilters: { ...invoiceFilters, ...next } }),
      replace,
    })
  }

  return (
    <section className={styles.board} aria-labelledby="invoices-title">
      <header className={styles.header}>
        <div>
          <h1 id="invoices-title">Счета</h1>
          <p className={styles.description}>
            Выставляете счёт — клиент получает ссылку: оплатить картой или скачать счёт на своё
            юрлицо (выбирает из сохранённых или добавляет по ИНН — оно запоминается в «Компаниях»).
            Один счёт — один продукт. Юрлицо-продавца выбираем мы: наши продукты — ИП Шумилов,
            партнёрские сервисы — ИП Швецова; карта — только у ИП Шумилов. Оплату отмечает сервер по
            банку Точка.
          </p>
        </div>
        <button
          type="button"
          data-variant="primary"
          onClick={() => setCreate(true)}
          disabled={!writable}
        >
          + Выставить счёт
        </button>
      </header>
      <div className={styles.tiles} aria-label="Сводка по счетам">
        <div className={styles.tile}>
          <strong>{money(invoiceCash(wait))}</strong>
          <span>ждём оплату</span>
          <small>{invoiceCount(wait.length)}</small>
        </div>
        <button className={styles.tile} type="button" onClick={() => setFilters({ tab: 'stale' })}>
          <strong className={styles.warning}>{stale.length}</strong>
          <span>без движения 5+ дней</span>
          <small>проверить сделку в rakurscrm</small>
        </button>
        <div className={styles.tile}>
          <strong>{money(invoiceCash(paid30))}</strong>
          <span>оплачено за 30 дней</span>
          <small>{invoiceCount(paid30.length)}</small>
        </div>
      </div>
      <div className={styles.tabs} role="group" aria-label="Фильтр по статусу счета">
        {Object.entries(invoiceTabs).map(([key, label]) => {
          const tabKey = key as InvoiceTab
          return (
            <button
              key={tabKey}
              type="button"
              aria-pressed={tab === tabKey}
              onClick={() => setFilters({ tab: tabKey })}
            >
              {label}
              <span className={styles.badge} data-warn={tabKey === 'stale' && stale.length > 0}>
                {current.filter((invoice) => matchesTab(invoice, tabKey)).length}
              </span>
            </button>
          )
        })}
      </div>
      <div className={styles.toolbar}>
        <span>{invoiceCount(rows.length)}</span>
        <div className={styles.filters}>
          <label>
            Наше юрлицо
            <select
              value={seller}
              onChange={(event) =>
                setFilters({ seller: event.currentTarget.value as InvoiceFilters['seller'] })
              }
            >
              <option value="">оба</option>
              {Object.entries(invoiceSellers).map(([key, { name }]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <input
            type="search"
            aria-label="Поиск счёта"
            placeholder="Номер, клиент, ИНН, сделка"
            value={query}
            onChange={(event) => setFilters({ query: event.currentTarget.value }, true)}
          />
        </div>
      </div>
      {message && (
        <p className={styles.message} role="status">
          {message}
        </p>
      )}
      <div className={styles.tableCard}>
        <table className={styles.table}>
          <colgroup>
            <col className={styles.numberCol} />
            <col className={styles.clientCol} />
            <col className={styles.descriptionCol} />
            <col className={styles.amountCol} />
            <col className={styles.choiceCol} />
            <col className={styles.statusCol} />
            <col className={styles.actionsCol} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Счёт</th>
              <th scope="col">Клиент</th>
              <th scope="col">За что</th>
              <th scope="col" className={styles.right}>
                Сумма
              </th>
              <th scope="col">Клиент выбрал</th>
              <th scope="col">Статус</th>
              <th scope="col" aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {rows.map((invoice) => {
              const client = findDemoClient(invoice.client)
              const supplier = invoiceSellers[invoice.seller ?? 'sh']
              const open = invoice.state === 'open'
              return (
                <tr key={invoice.id}>
                  <td>
                    <button
                      className={styles.number}
                      type="button"
                      aria-label="Открыть счёт"
                      onClick={() => {
                        setConfirmId('')
                        focusInvoice(invoice.id)
                      }}
                    >
                      {invoice.number ?? invoice.id}
                    </button>
                    <small>
                      {dateLabel(invoice.date)}
                      {invoice.by ? ' · ' + invoice.by : ''}
                    </small>
                  </td>
                  <td>
                    <Link
                      to="/managers"
                      search={(previous) => ({
                        ...previous,
                        section: 'invoices',
                        client: invoice.client,
                      })}
                    >
                      {client?.reference ? client.domain : (client?.name ?? '—')}
                    </Link>
                    <small>ID {invoice.client}</small>
                  </td>
                  <td>
                    <span className={styles.what} title={invoice.description}>
                      {invoice.description}
                    </span>
                    <small>
                      {invoiceKinds[invoice.kind ?? 'widget'].name} · {supplier.name}
                    </small>
                  </td>
                  <td className={styles.right}>
                    {money(invoice.amount)}
                    <small>
                      {invoice.bonus ? 'бонусами ' + money(invoice.bonus) : supplier.tax}
                    </small>
                  </td>
                  <td>
                    {invoice.method === 'card' ? (
                      'картой'
                    ) : invoice.payer ? (
                      <>
                        <span className={styles.payer} title={invoice.payer}>
                          {invoice.payer}
                        </span>
                        {invoice.downloads ? (
                          <small>
                            скачал счёт {invoice.downloads}{' '}
                            {downloadsPlural.select(invoice.downloads) === 'few' ? 'раза' : 'раз'}
                            {(invoice.legalEntities ?? 0) > 1
                              ? ' · на ' + invoice.legalEntities + ' юрлица'
                              : ''}
                          </small>
                        ) : null}
                      </>
                    ) : (
                      <small>ещё не выбрал</small>
                    )}
                  </td>
                  <td>
                    <InvoiceStatus invoice={invoice} />
                  </td>
                  <td>
                    {open && writable ? (
                      <div className={styles.actions}>
                        <CopyInvoiceLink
                          invoice={invoice}
                          onFallback={() => focusInvoice(invoice.id)}
                        />
                        <button
                          type="button"
                          className={styles.cancel}
                          data-confirm={confirmId === invoice.id}
                          onBlur={() =>
                            setConfirmId((current) => (current === invoice.id ? '' : current))
                          }
                          onClick={() => {
                            if (confirmId !== invoice.id) {
                              setConfirmId(invoice.id)
                              return
                            }
                            dispatch({ type: 'cancel', id: invoice.id })
                            setConfirmId('')
                            setMessage(
                              `Счёт ${invoice.number ?? invoice.id} аннулирован.${invoice.bonus ? ' Возвращены бонусы ' + money(invoice.bonus) + '.' : ''}`,
                            )
                          }}
                        >
                          {confirmId === invoice.id ? 'Да, точно' : 'Аннулировать'}
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7}>Счетов нет.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {create && writable && (
        <DetailDrawer title="Выставить счёт" open onClose={() => setCreate(false)}>
          <InvoiceForm
            close={() => setCreate(false)}
            showInvoice={(id) => {
              setCreate(false)
              setFilters({ tab: 'wait', seller: '', query: '' }, true)
              focusInvoice(id)
            }}
          />
        </DetailDrawer>
      )}
    </section>
  )
}
