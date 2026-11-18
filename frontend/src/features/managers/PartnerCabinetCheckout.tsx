import { useState } from 'react'
import { DetailDrawer } from '../../components/DetailDrawer'
import { money } from './DemoSession'
import { dateLabel } from './fixtures'
import type { CabinetOrder } from './partnerCabinetState'
import styles from './PartnerCabinet.module.css'

export type CabinetQuote = Pick<CabinetOrder, 'target' | 'title' | 'until' | 'price'>

export function PartnerProDetails({
  active,
  price,
  available,
  canTry,
  until,
  close,
  trial,
  buy,
}: {
  active: boolean
  price: number
  available: number
  canTry: boolean
  until: string
  close: () => void
  trial: () => void
  buy: () => void
}) {
  return (
    <DetailDrawer title="PRO-кабинет" open onClose={close}>
      <div className={styles.drawerContent}>
        <p>{money(price)} в год. Оплата по счёту, картой или бонусами.</p>
        <section className={styles.card}>
          <h3>Что даёт PRO</h3>
          <ul className={styles.proFeatures}>
            <li>Данные о лицензии amoCRM и истории продлений</li>
            <li>Контакты администраторов и список установленных виджетов</li>
            <li>До 10 промокодов, список клиентов и уведомления</li>
          </ul>
        </section>
        <p>
          После оплаты PRO до <strong>{dateLabel(until)}</strong>. Бонусами можно покрыть{' '}
          {money(Math.min(price, available))}.
        </p>
        <div className={styles.formActions}>
          {canTry ? (
            <button type="button" onClick={trial}>
              Попробовать 14 дней
            </button>
          ) : null}
          <button type="button" data-variant="primary" onClick={buy}>
            {active ? 'Продлить' : 'Подключить'} за {money(price)}
          </button>
        </div>
      </div>
    </DetailDrawer>
  )
}

export function PartnerCheckout({
  quote,
  available,
  close,
  submit,
}: {
  quote: CabinetQuote
  available: number
  close: () => void
  submit: (bonus: number, method: CabinetOrder['method']) => void
}) {
  const max = Math.min(available, quote.price)
  const [bonus, setBonus] = useState(String(max))
  const [method, setMethod] = useState<CabinetOrder['method']>('invoice')
  const selected = Number(bonus)
  const valid = Number.isSafeInteger(selected) && selected >= 0 && selected <= max
  const remaining = valid ? quote.price - selected : quote.price
  return (
    <DetailDrawer
      title={quote.target === 'pro' ? 'Оплата PRO-кабинета' : 'Оплата виджета'}
      open
      onClose={close}
    >
      <form
        className={styles.drawerContent}
        onSubmit={(event) => {
          event.preventDefault()
          if (valid) submit(selected, method)
        }}
      >
        <h3>{quote.title}</h3>
        <p>
          Срок после оплаты — до {dateLabel(quote.until)}. Всего {money(quote.price)}.
        </p>
        <label className={styles.field}>
          Использовать бонусы
          <input
            type="number"
            min={0}
            max={max}
            step={1}
            value={bonus}
            onChange={(event) => setBonus(event.target.value)}
          />
          <small>Доступно для оплаты {money(max)}</small>
        </label>
        {remaining > 0 ? (
          <label className={styles.field}>
            Способ оплаты
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value === 'card' ? 'card' : 'invoice')}
            >
              <option value="invoice">Счёт на юрлицо</option>
              <option value="card">Картой</option>
            </select>
          </label>
        ) : null}
        <p>
          К оплате деньгами <strong>{money(remaining)}</strong>
        </p>
        <div className={styles.formActions}>
          <button type="submit" data-variant="primary" disabled={!valid}>
            {remaining === 0
              ? 'Оплатить бонусами'
              : method === 'invoice'
                ? 'Выставить демо-счёт'
                : 'Создать демо-оплату картой'}
          </button>
        </div>
      </form>
    </DetailDrawer>
  )
}

export function PartnerOrderDetails({
  order,
  close,
  settle,
  cancel,
}: {
  order: CabinetOrder
  close: () => void
  settle: () => void
  cancel: () => void
}) {
  return (
    <DetailDrawer
      title={order.method === 'invoice' ? `Демо-счёт ${order.id}` : 'Демо-оплата картой'}
      open
      onClose={close}
    >
      <div className={styles.drawerContent}>
        <h3>{order.title}</h3>
        <p>
          К оплате {money(order.price - order.bonus)}. Зарезервировано бонусов: {money(order.bonus)}
          .
        </p>
        <p>Подтверждение обновит срок до {dateLabel(order.until)} в этой вкладке.</p>
        <div className={styles.formActions}>
          <button type="button" onClick={cancel}>
            Отменить оплату
          </button>
          <button type="button" data-variant="primary" onClick={settle}>
            Подтвердить демо-оплату
          </button>
        </div>
      </div>
    </DetailDrawer>
  )
}
