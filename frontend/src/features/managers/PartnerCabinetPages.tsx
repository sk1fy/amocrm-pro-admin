import { useState } from 'react'
import { Panel, Table } from './AccountPanel'
import { findDemoClient } from './clientDirectory'
import { money } from './DemoSession'
import { dateLabel } from './fixtures'
import {
  cabinetPromoClients,
  defaultCabinetPartner,
  type CabinetInstall,
  type CabinetOrder,
} from './partnerCabinetState'
import type { Partner, PartnerRequest } from './partnerDirectory'
import { widgetCatalog } from './widgetCatalog'
import styles from './PartnerCabinet.module.css'

export const partnerRequestStatus = {
  allowed: 'Оплата через партнёра разрешена',
  denied: 'Оплата через партнёра недоступна',
  pending: 'Запрос отправлен',
} as const

export function PartnerAccounts({
  installs,
  active,
  details,
}: {
  installs: CabinetInstall[]
  active: boolean
  details: () => void
}) {
  const counts = new Map<string, number>()
  for (const { account } of installs) counts.set(account, (counts.get(account) ?? 0) + 1)
  return (
    <>
      <header className={styles.heading}>
        <h1>Аккаунты</h1>
        <p>Аккаунты, где стоят ваши виджеты. Данные о лицензиях amoCRM открываются в PRO.</p>
      </header>
      <Panel title="Мои аккаунты" hint={String(counts.size)}>
        {!active && counts.size ? (
          <button type="button" onClick={details}>
            Что даёт PRO
          </button>
        ) : null}
        <Table
          columns={['Аккаунт', 'Клиент', 'Ваших виджетов', 'Лицензия до']}
          rows={Array.from(counts, ([id, count]) => {
            const client = findDemoClient(id)
            return {
              id,
              cells: [
                client?.domain ?? id,
                client?.name ?? '—',
                String(count),
                active && client ? dateLabel(client.till) : 'PRO',
              ],
            }
          })}
        />
      </Panel>
    </>
  )
}

export function PartnerClients({
  partner,
  active,
  details,
}: {
  partner: Partner
  active: boolean
  details: () => void
}) {
  const fromPromo = partner.id === defaultCabinetPartner
  const owned = partner.accounts.flatMap((id) => {
    const client = findDemoClient(id)
    return client ? [client] : []
  })
  const leads = cabinetPromoClients.filter(({ id }) => partner.accounts.includes(id))
  return (
    <>
      <header className={styles.heading}>
        <h1>Мои клиенты</h1>
        <p>
          Аккаунты, закреплённые за вами. В списке по промокодам остаются клиенты, привлечённые в
          период действия PRO.
        </p>
      </header>
      {fromPromo ? (
        <Panel title="Клиенты по промокодам" hint={String(leads.length)}>
          <Table
            columns={['Дата', 'Имя', 'Телефон', 'ID аккаунта', 'Виджет', 'Промокод']}
            rows={leads.map(({ id, date, name, phone, widget, code }) => ({
              id,
              cells: [
                dateLabel(date),
                name,
                phone,
                { text: id, note: findDemoClient(id)?.domain },
                widget,
                code,
              ],
            }))}
          />
        </Panel>
      ) : active ? (
        <Panel title="Мои клиенты">
          <Table
            columns={['Аккаунт', 'Клиент', 'Лицензия до', 'Пользователей']}
            rows={owned.map((client) => ({
              id: client.id,
              cells: [client.domain, client.name, dateLabel(client.till), client.seats],
            }))}
          />
        </Panel>
      ) : (
        <Panel title="Нужен PRO">
          <p>Список клиентов и контакты доступны при активном PRO.</p>
          <button type="button" onClick={details}>
            Что даёт PRO
          </button>
        </Panel>
      )}
    </>
  )
}

export function PartnerPromos({
  partner,
  active,
  canCreate,
  add,
  toggle,
}: {
  partner: Partner
  active: boolean
  canCreate: (code: string) => boolean
  add: (code: string) => void
  toggle: (code: string) => void
}) {
  const [error, setError] = useState('')
  const limit = 10
  const seeds =
    partner.id === defaultCabinetPartner
      ? cabinetPromoClients.filter(({ id }) => partner.accounts.includes(id))
      : []
  return (
    <>
      <header className={styles.heading}>
        <h1>Промокоды</h1>
        <p>
          Промокод прибавляет месяц к сроку виджета. Новый аккаунт закрепляется за партнёром и
          попадает в «Мои клиенты».
        </p>
      </header>
      <Panel title="Мои промокоды" hint={`${partner.promos.length} из ${limit}`}>
        {!active ? (
          <p>Промокоды сейчас не работают. Подключите PRO, чтобы снова принимать коды.</p>
        ) : null}
        {partner.promos.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.secondaryTable}>
              <thead>
                <tr>
                  <th scope="col">Промокод</th>
                  <th scope="col">Состояние</th>
                  <th scope="col">Новых клиентов</th>
                  <th scope="col" aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {partner.promos.map((code) => {
                  const enabled = !partner.inactivePromos?.includes(code)
                  return (
                    <tr key={code}>
                      <th scope="row">{code}</th>
                      <td>{!active ? 'не работает без PRO' : enabled ? 'работает' : 'выключен'}</td>
                      <td>{seeds.filter((lead) => lead.code === code).length}</td>
                      <td>
                        <button
                          type="button"
                          aria-pressed={enabled}
                          aria-label={`${code}: ${enabled ? 'выключить' : 'включить'}`}
                          onClick={() => toggle(code)}
                        >
                          {enabled ? 'Выключить' : 'Включить'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p>Промокодов пока нет.</p>
        )}
        <form
          className={styles.inlineForm}
          onSubmit={(event) => {
            event.preventDefault()
            if (!active || partner.promos.length >= limit) return
            const code = String(new FormData(event.currentTarget).get('code')).trim().toUpperCase()
            if (!canCreate(code)) {
              setError('Такой промокод уже существует')
              return
            }
            add(code)
            event.currentTarget.reset()
            setError('')
          }}
        >
          <label className={styles.field}>
            Новый промокод
            <input
              name="code"
              maxLength={20}
              required
              pattern="[A-Za-z0-9\-]{3,20}"
              placeholder="Например, AMO10"
              disabled={!active || partner.promos.length >= limit}
            />
          </label>
          <button
            type="submit"
            data-variant="primary"
            disabled={!active || partner.promos.length >= limit}
          >
            Создать промокод
          </button>
          {error ? <span role="alert">{error}</span> : null}
        </form>
      </Panel>
    </>
  )
}

export function PartnerCatalog() {
  return (
    <>
      <header className={styles.heading}>
        <h1>Наши виджеты</h1>
        <p>
          Каталог Ракурса. При установке клиенту укажите свой номер в форме активации, чтобы
          привязать установку.
        </p>
      </header>
      <Panel title="Каталог виджетов">
        <div className={styles.tableScroll}>
          <table className={styles.secondaryTable}>
            <thead>
              <tr>
                <th scope="col">Виджет</th>
                <th scope="col">Цена для клиента</th>
                <th scope="col">Ваша цена</th>
                <th scope="col">Тест</th>
                <th scope="col">Ссылки</th>
              </tr>
            </thead>
            <tbody>
              {widgetCatalog.map((widget) => {
                const tariff = widget.tariffs.find(({ price }) => price > 0)
                return (
                  <tr key={widget.code}>
                    <th scope="row">
                      <span className={styles.tier} data-tier={widget.tier}>
                        {widget.tier}
                      </span>{' '}
                      {widget.name}
                    </th>
                    <td>
                      {tariff ? `${money(tariff.price)} за ${tariff.months} мес.` : 'Бесплатный'}
                    </td>
                    <td>
                      {tariff
                        ? `${money(tariff.price / 2)} · продление ${money(tariff.price * 0.6)}`
                        : '—'}
                    </td>
                    <td>{widget.trial ? `${widget.trial} дн.` : '—'}</td>
                    <td>
                      <div className={styles.formActions}>
                        {widget.installUrl ? (
                          <a href={widget.installUrl} target="_blank" rel="noreferrer">
                            Установить
                          </a>
                        ) : (
                          <span>После модерации</span>
                        )}
                        {widget.guideUrl ? (
                          <a href={widget.guideUrl} target="_blank" rel="noreferrer">
                            Инструкция
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}

const notifications = [
  ['promo', 'Новый клиент по промокоду', true],
  ['payment', 'Счёт оплачен или отменён', false],
  ['test', 'Тест виджета заканчивается', false],
  ['request', 'Решение по запросу на оплату', false],
  ['quiet', 'Не беспокоить ночью, с 21:00 до 9:00', false],
] as const

export function PartnerNotifications({
  partner,
  active,
  requests,
  update,
}: {
  partner: Partner
  active: boolean
  requests: PartnerRequest[]
  update: (patch: Partial<Partner>) => void
}) {
  return (
    <>
      <header className={styles.heading}>
        <h1>Уведомления</h1>
        <p>Настройки Telegram и Max для событий по вашим клиентам в демо.</p>
      </header>
      <div className={styles.cards}>
        {(['telegram', 'max'] as const).map((channel) => (
          <Panel key={channel} title={channel === 'telegram' ? 'Telegram' : 'Max'}>
            <p>{partner[channel] ? 'Подключено в демо' : 'Демо-канал отключён'}</p>
            <button type="button" onClick={() => update({ [channel]: !partner[channel] })}>
              {partner[channel] ? 'Отключить' : 'Подключить в демо'}
            </button>
          </Panel>
        ))}
      </div>
      <Panel title="О чём сообщать">
        <div className={styles.drawerContent}>
          {notifications.map(([key, name, proOnly]) => (
            <label key={key} className={styles.check}>
              <input
                type="checkbox"
                disabled={proOnly && !active}
                checked={partner.notifySettings?.[key] ?? key !== 'quiet'}
                onChange={(event) =>
                  update({
                    notifySettings: { ...partner.notifySettings, [key]: event.target.checked },
                  })
                }
              />
              {name}
              {proOnly ? ' · PRO' : ''}
            </label>
          ))}
        </div>
      </Panel>
      <Panel title="Запросы и реквизиты">
        {partner.id.startsWith('partner-') ? (
          <p>
            {partner.approved
              ? 'Доступ TOP одобрен. Новых уведомлений нет.'
              : partner.request
                ? 'Заявка ожидает решения менеджера.'
                : 'Заявок пока нет.'}
          </p>
        ) : null}
        {requests.length ? (
          <ul>
            {requests.map((request) => (
              <li key={request.id}>
                {findDemoClient(request.account)?.domain ?? request.account} · {request.widget} ·{' '}
                {partnerRequestStatus[request.status]}
              </li>
            ))}
          </ul>
        ) : null}
        <form
          className={styles.inlineForm}
          onSubmit={(event) => {
            event.preventDefault()
            update({ legal: String(new FormData(event.currentTarget).get('legal')).trim() })
          }}
        >
          <label className={styles.field}>
            Наименование компании
            <input name="legal" required defaultValue={partner.legal} />
          </label>
          <button type="submit">Сохранить реквизиты</button>
        </form>
      </Panel>
    </>
  )
}

export function PartnerOperations({
  partner,
  available,
  held,
  active,
  details,
  review,
  legacyPro,
}: {
  partner: Partner
  available: number
  held: number
  active: boolean
  details: () => void
  review: (order: CabinetOrder) => void
  legacyPro?: () => void
}) {
  const orders = partner.cabinetOrders ?? []
  const opened = orders.filter(({ state }) => state === 'open')
  return (
    <>
      <header className={styles.heading}>
        <h1>Бонусы и операции</h1>
        <p>Начисления бонусов, скидки и демо-счета за виджеты и PRO.</p>
      </header>
      <div className={styles.cards}>
        <Panel title={`Бонусный баланс ${money(available)}`}>
          <p>
            Бонусы используются как скидка при оплате.{' '}
            {held
              ? `Под выставленные счета заморожено ${money(held)}.`
              : 'Деньгами не пополняется.'}
          </p>
        </Panel>
        <Panel title={active ? `PRO до ${dateLabel(partner.proTill)}` : 'Подключить PRO'}>
          {legacyPro ? (
            <button type="button" disabled={available < 12000} onClick={legacyPro}>
              Продлить PRO за бонусы
            </button>
          ) : (
            <button type="button" onClick={details}>
              {active ? 'Продлить PRO' : 'Что даёт PRO'}
            </button>
          )}
        </Panel>
      </div>
      <Panel title="Счета к оплате" hint={String(opened.length)}>
        {opened.length ? (
          <ul className={styles.openOrders}>
            {opened.map((order) => (
              <li key={order.id}>
                <span>
                  {order.title} · {money(order.price - order.bonus)}
                </span>
                <button type="button" onClick={() => review(order)}>
                  Открыть оплату {order.id}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>Нет счетов к оплате.</p>
        )}
      </Panel>
      <Panel title="История операций">
        {partner.operations.length || orders.some(({ state }) => state === 'cancelled') ? (
          <ul>
            {partner.operations.map((op, index) => (
              <li key={index}>{op}</li>
            ))}
            {orders
              .filter(({ state }) => state === 'cancelled')
              .map((order) => (
                <li key={order.id}>{order.title} · отменено</li>
              ))}
          </ul>
        ) : (
          <p>Операций в демо-сессии пока нет.</p>
        )}
      </Panel>
    </>
  )
}
