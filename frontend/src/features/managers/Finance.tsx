import { useId, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { DetailDrawer } from '../../components/DetailDrawer'
import { Panel } from './AccountPanel'
import { can, cellText, money, today, useDemo, type Invoice } from './DemoSession'
import { demoClients, findDemoClient } from './clientDirectory'
import { dateLabel, type DemoRow } from './fixtures'
import {
  invoiceKinds,
  invoiceSellers,
  nextInvoiceNumber,
  type InvoiceKind,
  type InvoiceSeller,
} from './invoiceFixtures'
import styles from './AccountPanels.module.css'

const reasons = ['Сделка AMO', 'Партнёр', 'Бонус', 'Тест']
export function Renewal({ row, close }: { row: DemoRow; close: () => void }) {
  const { actor, dispatch } = useDemo()
  const [reason, setReason] = useState(reasons[0])
  const [mode, setMode] = useState('tariff')
  const [months, setMonths] = useState(3)
  const [manual, setManual] = useState('')
  const [detail, setDetail] = useState('')
  const [comment, setComment] = useState('')
  const [users, setUsers] = useState(1)
  const [error, setError] = useState('')
  const old = row.paidUntil ? cellText(row.paidUntil) : ''
  const oldISO = old.split('.').reverse().join('-')
  const base = /^\d{4}-\d{2}-\d{2}$/.test(oldISO) && oldISO > today ? oldISO : today
  const date = new Date(base + 'T00:00:00Z')
  if (reason === 'Тест') date.setUTCDate(date.getUTCDate() + 7)
  else date.setUTCMonth(date.getUTCMonth() + months)
  const until = reason === 'Тест' || mode === 'tariff' ? date.toISOString().slice(0, 10) : manual
  return (
    <DetailDrawer title={`Продлить · ${cellText(row.cells[1])}`} open onClose={close}>
      <p>Аккаунт {row.client}. Здесь меняется только срок; деньги учитываются при оплате счёта.</p>
      <form
        className={styles.stack}
        onSubmit={(event) => {
          event.preventDefault()
          if (!can(actor, 'pay')) return
          let validDeal = /^\d+$/.test(detail.trim())
          try {
            validDeal ||=
              /^https?:$/.test(new URL(detail).protocol) &&
              /\/leads\/detail\/\d+/.test(new URL(detail).pathname)
          } catch {
            /* A numeric deal does not need URL parsing. */
          }
          if (
            !until ||
            (reason === 'Сделка AMO' && !validDeal) ||
            (reason === 'Партнёр' && !detail)
          ) {
            setError('Укажите дату и основание: номер или ссылку на сделку либо партнёра.')
            return
          }
          dispatch({
            type: 'renew',
            id: row.id,
            until,
            reason,
            detail: `${detail || reason} · ${users} пользователей · ${comment || 'без комментария'}`,
            bonus: 0,
          })
          close()
        }}
      >
        <label>
          Основание
          <select
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setDetail('')
            }}
          >
            {reasons.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        {reason !== 'Тест' ? (
          <>
            <label>
              Как изменить дату
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="tariff">Продление по тарифу</option>
                <option value="manual">Ручная правка менеджера</option>
              </select>
            </label>
            {mode === 'tariff' ? (
              <label>
                Тариф
                <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                  {[1, 3, 6, 12].map((n) => (
                    <option key={n} value={n}>
                      {n} мес.
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Продлить до
                <input
                  type="date"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  required
                />
              </label>
            )}
          </>
        ) : (
          <p>Тест +7 дней от текущего срока или сегодняшнего дня.</p>
        )}
        {reason === 'Сделка AMO' ? (
          <label>
            ID сделки или ссылка
            <input required value={detail} onChange={(e) => setDetail(e.target.value)} />
          </label>
        ) : reason === 'Партнёр' ? (
          <label>
            Партнёр
            <select required value={detail} onChange={(e) => setDetail(e.target.value)}>
              <option value="">Выберите партнёра</option>
              <option>Интегратор Север</option>
              <option>Точка CRM</option>
              <option>Парус</option>
            </select>
          </label>
        ) : null}
        <label>
          Пользователей
          <input
            type="number"
            min="1"
            required
            value={users}
            onChange={(e) => setUsers(Number(e.target.value))}
          />
        </label>
        <label>
          Комментарий
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        <Panel title="Итог продления">
          <p>
            Было: {old}. Станет: {until || 'выберите дату'}.
          </p>
          {until && until < base ? <p>Срок сократится.</p> : null}
          <p>
            {reason === 'Бонус' || reason === 'Тест'
              ? 'В подарок · без списания клиентских бонусов'
              : 'Без поступления денег'}
          </p>
        </Panel>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" data-variant="primary">
          Подтвердить продление
        </button>
      </form>
    </DetailDrawer>
  )
}

export function InvoiceForm({
  client,
  close,
  showInvoice,
}: {
  client?: string
  close: () => void
  showInvoice?: (id: string) => void
}) {
  const { state, actor, dispatch } = useDemo()
  const [error, setError] = useState('')
  const [installation, setInstallation] = useState('')
  const [clientTerm, setClientTerm] = useState('')
  const [kind, setKind] = useState<InvoiceKind>('widget')
  const [seller, setSeller] = useState<InvoiceSeller>('sh')
  const listId = useId()
  const search = clientTerm.trim().toLocaleLowerCase('ru')
  const eligible = demoClients.filter(
    (client) => state.accounts[client.id].owner !== 'Запрет работы',
  )
  const selected =
    client ??
    eligible.find((option) => {
      return (
        option.id === search ||
        option.domain === search ||
        `${option.domain} · ${option.id}` === search
      )
    })?.id
  const available = selected ? state.accounts[selected].bonus : 0
  const number = nextInvoiceNumber(state.invoices, seller, kind)

  return (
    <form
      className={client ? styles.peopleForm : styles.stack}
      onSubmit={(event) => {
        event.preventDefault()
        if (!can(actor, 'pay')) return
        const fields = new FormData(event.currentTarget)
        const amount = Number(fields.get('amount'))
        const bonus = Number(fields.get('bonus'))
        const description = String(fields.get('description')).trim()
        if (!selected) {
          setError('Выберите аккаунт по поддомену или ID amoCRM.')
          return
        }
        if (!description) {
          setError('Укажите, за что выставляется счёт.')
          return
        }
        if (!Number.isSafeInteger(bonus) || bonus > amount || bonus > available) {
          setError('Бонусы должны быть целым числом в пределах суммы счёта и доступного баланса.')
          return
        }
        const invoice: Invoice = {
          id: number,
          number,
          client: selected,
          description,
          amount,
          bonus,
          date: today,
          by: actor.name,
          state: 'open',
          kind,
          seller,
          deal: String(fields.get('deal') ?? '').trim() || undefined,
          installation: installation || undefined,
          until: installation ? String(fields.get('until')) : undefined,
        }
        dispatch({ type: 'invoice', invoice })
        if (showInvoice) showInvoice(invoice.id)
        else close()
      }}
    >
      {client ? null : (
        <>
          <p>Один счёт — один продукт. Клиент получит ссылку на оплату.</p>
          <label>
            Что продаём
            <select
              value={kind}
              onChange={(event) => {
                const value = event.currentTarget.value as InvoiceKind
                setKind(value)
                setSeller(invoiceKinds[value].seller)
                setInstallation('')
              }}
            >
              {Object.entries(invoiceKinds).map(([key, item]) => (
                <option key={key} value={key}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Клиент — аккаунт amoCRM
            <input
              list={listId}
              placeholder="Поддомен или ID"
              value={clientTerm}
              onChange={(event) => {
                setClientTerm(event.currentTarget.value)
                setInstallation('')
              }}
              required
            />
          </label>
          <datalist id={listId}>
            {eligible.map((client) => (
              <option key={client.id} value={`${client.domain} · ${client.id}`}>
                {client.name}
              </option>
            ))}
          </datalist>
        </>
      )}
      <label>
        За что
        <input name="description" required />
      </label>
      <label>
        Сумма, ₽<input name="amount" type="number" min="0.01" step="0.01" required />
      </label>
      {invoiceKinds[kind].bonus ? (
        <label>
          Использовать бонусы
          <input
            key={selected}
            name="bonus"
            type="number"
            min="0"
            max={available}
            defaultValue="0"
            disabled={!available}
          />
        </label>
      ) : null}
      {kind === 'widget' ? (
        <label>
          Продлить после оплаты
          <select value={installation} onChange={(e) => setInstallation(e.target.value)}>
            <option value="">Без продления</option>
            {state.rows
              .filter((r) => r.client === selected)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {cellText(r.cells[1])}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      {installation ? (
        <label>
          Срок после оплаты
          <input name="until" type="date" min="2026-11-17" required />
        </label>
      ) : null}
      {client ? null : (
        <>
          <label>
            Наше юрлицо
            <select
              value={seller}
              onChange={(event) => setSeller(event.currentTarget.value as InvoiceSeller)}
            >
              {Object.entries(invoiceSellers).map(([key, item]) => (
                <option key={key} value={key}>
                  {item.name} · {item.tax}
                </option>
              ))}
            </select>
          </label>
          <label>
            Сделка в rakurscrm
            <input name="deal" placeholder="Номер или ссылка" />
          </label>
          <p>Номер счёта {number}</p>
        </>
      )}
      <button type="submit" data-variant="primary">
        {client ? 'Выставить демо-счёт' : 'Выставить и получить ссылку'}
      </button>
      <button type="button" onClick={close}>
        Отмена
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  )
}

function invoiceLink(invoice: Invoice) {
  const link = new URL('/managers', window.location.origin)
  link.searchParams.set('section', 'invoices')
  link.searchParams.set('invoice', invoice.id)
  return link.href
}

export function CopyInvoiceLink({
  invoice,
  onFallback,
}: {
  invoice: Invoice
  onFallback: () => void
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(invoiceLink(invoice))
          setCopied(true)
        } catch {
          onFallback()
        }
      }}
    >
      {copied ? 'Скопировано ✓' : 'Ссылка'}
    </button>
  )
}

export function InvoiceActions({ id }: { id: string }) {
  const { focusInvoice } = useDemo()
  return (
    <button type="button" onClick={() => focusInvoice(id)}>
      Открыть счёт
    </button>
  )
}

export function InvoiceDrawer() {
  const { state, invoiceFocus, focusInvoice } = useDemo()
  const { invoice: linkId } = useSearch({ from: '/managers' })
  const navigate = useNavigate({ from: '/managers' })
  const id = invoiceFocus ?? linkId
  const invoice = state.invoices.find((entry) => entry.id === id)
  if (!id) return null
  const close = () => {
    focusInvoice(null)
    if (linkId) {
      void navigate({
        search: (previous) => ({ ...previous, invoice: undefined }),
        replace: true,
      })
    }
  }
  if (!invoice)
    return (
      <DetailDrawer title="Счёт недоступен" open onClose={close}>
        <p>Счёт, созданный в демо, доступен до обновления вкладки.</p>
      </DetailDrawer>
    )
  return (
    <InvoiceDetails
      key={linkId && !invoiceFocus ? `linked:${id}` : id}
      invoice={invoice}
      showPreview={Boolean(linkId && !invoiceFocus)}
      close={close}
    />
  )
}

function InvoiceDetails({
  invoice,
  showPreview,
  close,
}: {
  invoice: Invoice
  showPreview: boolean
  close: () => void
}) {
  const { actor, dispatch, focusInvoice } = useDemo()
  const [preview, setPreview] = useState(showPreview)
  const seller = invoiceSellers[invoice.seller ?? 'sh']
  const number = invoice.number ?? invoice.id
  const client = findDemoClient(invoice.client)
  const open = invoice.state === 'open'
  const amount = money(invoice.amount - invoice.bonus)
  const invoiceLinkId = useId()

  return (
    <DetailDrawer title={preview ? 'Как видит клиент' : `Счёт ${number}`} open onClose={close}>
      {preview ? (
        <Panel title={`Счёт ${number} от ${dateLabel(invoice.date)}`}>
          <p>{invoice.description}</p>
          <p>
            <strong>К оплате: {amount}</strong>
          </p>
          <p>
            Продавец — {seller.name}, {seller.tax}.
          </p>
          {invoice.state === 'paid' ? (
            <p>Счёт оплачен.</p>
          ) : invoice.state === 'cancelled' ? (
            <p>Счёт аннулирован.</p>
          ) : (
            <p>Способы оплаты: {seller.card ? 'картой или по счёту' : 'по счёту'}. Демо-ссылка.</p>
          )}
        </Panel>
      ) : (
        <>
          <p>
            {client?.domain} · {invoiceKinds[invoice.kind ?? 'widget'].name} ·{' '}
            {dateLabel(invoice.date)}
          </p>
          <p>
            {invoice.description} · {money(invoice.amount)}
          </p>
          <p>
            Бонусы: {money(invoice.bonus)}. К оплате: {amount}.
          </p>
          <p>
            Наше юрлицо — {seller.name}, {seller.tax}.
          </p>
          {invoice.deal && <p>Сделка в rakurscrm — {invoice.deal}.</p>}
          {invoice.payer && (
            <p>
              Плательщик — {invoice.payer}, ИНН {invoice.payerInn ?? '—'}.
            </p>
          )}
          {open ? (
            <>
              <label className={styles.stack}>
                Демо-ссылка на счёт
                <input
                  id={invoiceLinkId}
                  readOnly
                  value={invoiceLink(invoice)}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              {!invoice.snapshot && !invoice.legacy && (
                <p>Ссылка на этот счёт доступна в текущей вкладке до её обновления.</p>
              )}
              <div className={styles.chips}>
                <CopyInvoiceLink
                  invoice={invoice}
                  onFallback={() => {
                    const input = document.getElementById(invoiceLinkId)
                    input?.focus()
                  }}
                />
                <Link
                  to="/managers"
                  search={{ section: 'invoices', client: undefined, invoice: invoice.id }}
                  onClick={() => focusInvoice(null)}
                >
                  Открыть демо-ссылку
                </Link>
                {can(actor, 'pay') ? (
                  <>
                    <button
                      type="button"
                      data-variant="primary"
                      onClick={() => dispatch({ type: 'settle', id: invoice.id })}
                    >
                      Подтвердить демо-оплату
                    </button>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'cancel', id: invoice.id })}
                    >
                      Аннулировать счёт
                    </button>
                  </>
                ) : null}
              </div>
            </>
          ) : null}
          {invoice.receipt ? (
            <Panel title="Квитанция">
              <p role="status">{invoice.receipt}</p>
              <p>Демо-операция.</p>
            </Panel>
          ) : (
            <p>
              {invoice.state === 'open'
                ? 'Ожидает оплаты'
                : invoice.state === 'paid'
                  ? 'Оплачен'
                  : 'Аннулирован'}
            </p>
          )}
        </>
      )}
      <button type="button" onClick={() => setPreview((previous) => !previous)}>
        {preview ? 'К счёту' : 'Как видит клиент'}
      </button>
    </DetailDrawer>
  )
}
