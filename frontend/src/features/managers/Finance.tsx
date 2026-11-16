import { useState } from 'react'
import { DetailDrawer } from '../../components/DetailDrawer'
import { Panel } from './AccountPanel'
import { can, cellText, money, today, useDemo, type Invoice } from './DemoSession'
import type { DemoRow } from './fixtures'
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

export function InvoiceForm({ client, close }: { client: string; close: () => void }) {
  const { state, dispatch } = useDemo()
  const [error, setError] = useState('')
  const [installation, setInstallation] = useState('')
  return (
    <form
      className={styles.peopleForm}
      onSubmit={(event) => {
        event.preventDefault()
        const f = new FormData(event.currentTarget)
        const amount = Number(f.get('amount'))
        const bonus = Number(f.get('bonus'))
        if (bonus > amount || bonus > state.accounts[client].bonus) {
          setError('Бонусы превышают сумму счёта или доступный баланс.')
          return
        }
        const invoice: Invoice = {
          id: `Демо-${state.invoices.length + 1}`,
          client,
          description: String(f.get('description')).trim(),
          amount,
          bonus,
          date: today,
          state: 'open',
          installation: installation || undefined,
          until: installation ? String(f.get('until')) : undefined,
        }
        dispatch({ type: 'invoice', invoice })
        close()
      }}
    >
      <label>
        За что
        <input name="description" required />
      </label>
      <label>
        Сумма, ₽<input name="amount" type="number" min="0.01" step="0.01" required />
      </label>
      <label>
        Использовать бонусы
        <input
          name="bonus"
          type="number"
          min="0"
          max={state.accounts[client].bonus}
          defaultValue="0"
        />
      </label>
      <label>
        Продлить после оплаты
        <select value={installation} onChange={(e) => setInstallation(e.target.value)}>
          <option value="">Без продления</option>
          {state.rows
            .filter((r) => r.client === client)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {cellText(r.cells[1])}
              </option>
            ))}
        </select>
      </label>
      {installation ? (
        <label>
          Срок после оплаты
          <input name="until" type="date" min="2026-11-17" required />
        </label>
      ) : null}
      <button type="submit" data-variant="primary">
        Выставить демо-счёт
      </button>
      <button type="button" onClick={close}>
        Отмена
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
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
  const { state, actor, dispatch, invoiceFocus: id, focusInvoice } = useDemo()
  const invoice = state.invoices.find((v) => v.id === id)
  if (!invoice) return null
  return (
    <>
      <DetailDrawer title={`Счёт ${id}`} open={!!id} onClose={() => focusInvoice(null)}>
        <p>
          {invoice.description} · {money(invoice.amount)}
        </p>
        <p>
          Бонусы: {money(invoice.bonus)}. К оплате: {money(invoice.amount - invoice.bonus)}.
        </p>
        {invoice.state === 'open' && can(actor, 'pay') ? (
          <div className={styles.chips}>
            <button
              type="button"
              data-variant="primary"
              onClick={() => dispatch({ type: 'settle', id: invoice.id })}
            >
              Подтвердить демо-оплату
            </button>
            <button type="button" onClick={() => dispatch({ type: 'cancel', id: invoice.id })}>
              Аннулировать счёт
            </button>
          </div>
        ) : null}
        {invoice.receipt ? (
          <Panel title="Квитанция">
            <p role="status">{invoice.receipt}</p>
            <p>Только демо. Внешний платёж не проводился.</p>
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
      </DetailDrawer>
    </>
  )
}
