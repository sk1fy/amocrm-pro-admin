import type { ReactNode } from 'react'
import { plural } from '../accounts/accountText'
import { findDemoClient } from './clientDirectory'
import { money } from './DemoSession'
import { dateLabel } from './fixtures'
import {
  cabinetPrice,
  requiresPartnerRequest,
  type CabinetInstall,
  type CabinetOrder,
} from './partnerCabinetState'
import type { Partner, PartnerRequest } from './partnerDirectory'
import type { PartnerCabinetFilters } from './partnerCabinetSearch'
import styles from './PartnerCabinet.module.css'

export const partnerIcons = {
  widgets: 'M3 3h5v5H3zm7 0h5v5h-5zM3 10h5v5H3zm7 0h5v5h-5z',
  accounts: 'M4 2.5h10v13H4zm2 4h6m-6 3h6m-6 3h3',
  clients:
    'M12 13v-1a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v1m7-8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm3-2a2.5 2.5 0 0 1 0 4.5m1 2.5a3 3 0 0 1 2 2.8V13',
  promo: 'M2.5 3h6.3l6.5 6.6-5.7 5.7L3 8.7zM6 6h.1',
  catalog: 'M3 4h4.5L9 5.5 10.5 4H15v10h-4.5L9 15l-1.5-1H3zm6 1.5V15',
  notify: 'M4 12V8a5 5 0 1 1 10 0v4l1 1H3zm3 3a2 2 0 0 0 4 0',
  balance: 'M3 4h12v10H3zm0 4h12m-9 3h2',
  terms: 'M13.6 6a5.6 5.6 0 1 0 .3 5.5M14 3.5v4h-4m-1-.7v3l2 1',
}

export function PartnerIcon({ name }: { name: keyof typeof partnerIcons }) {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d={partnerIcons[name]}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

type HomeProps = {
  partner: Partner
  installs: CabinetInstall[]
  held: number
  filters: PartnerCabinetFilters
  setFilters: (filters: PartnerCabinetFilters) => void
  requests: PartnerRequest[]
  operationLink: ReactNode
  accountsLink: ReactNode
  onTest: (install: CabinetInstall) => void
  onPay: (install: CabinetInstall) => void
  onReview: (order: CabinetOrder) => void
  onRequest: (install: CabinetInstall) => void
}

export function PartnerCabinetHome({
  partner,
  installs,
  held,
  filters,
  setFilters,
  requests,
  operationLink,
  accountsLink,
  onTest,
  onPay,
  onReview,
  onRequest,
}: HomeProps) {
  const { query = '', from = '', to = '' } = filters
  const term = query.trim().toLocaleLowerCase('ru')
  const results = installs.filter(({ account, until }) => {
    const client = findDemoClient(account)
    return (
      (!term ||
        [account, client?.name, client?.domain].join(' ').toLocaleLowerCase('ru').includes(term)) &&
      (!from || until >= from) &&
      (!to || (!!until && until <= to))
    )
  })
  const filtered = Boolean(term || from || to)
  return (
    <>
      <header className={styles.heading}>
        <h1>Кабинет партнёра</h1>
        <p>
          {partner.name}
          {partner.phones.length
            ? ` · виджеты, которые установили с вашими номерами: ${partner.phones.join(', ')}. Номера меняет администратор Ракурса.`
            : ' · виджеты на аккаунтах ваших клиентов.'}
        </p>
      </header>
      <div className={styles.cards}>
        <section className={styles.card}>
          <div className={styles.cardTitle}>
            <span className={styles.cardIcon}>
              <PartnerIcon name="balance" />
            </span>
            <div>
              <h2>Бонусный баланс</h2>
              <strong>{money(partner.bonus - held)}</strong>
              {held > 0 ? <small>Заморожено под счета: {money(held)}</small> : null}
            </div>
          </div>
          <p className={styles.hint}>
            Бонусы начисляет Ракурс — за акции и активность. Используйте их как скидку при оплате
            виджетов и PRO, вплоть до 100%.
          </p>
          <div>{operationLink}</div>
        </section>
        <section className={styles.card}>
          <div className={styles.cardTitle}>
            <span className={styles.cardIcon}>
              <PartnerIcon name="terms" />
            </span>
            <h2>Ваши условия</h2>
          </div>
          <p>
            Первая оплата виджета — вы платите <strong>50%</strong> цены. Продление —{' '}
            <strong>60%</strong>, ваша выгода 40%. Платите счётом на юрлицо или картой, бонусы —
            скидка до 100%. «Первая» — если виджет в этом аккаунте ещё никто не оплачивал. Тест
            можно продлить на 7 дней <strong>один раз за оплаченный период</strong> — после каждой
            оплаты право возвращается. Продлили клиенту amoCRM — продлите ему все наши TOP-виджеты
            бонусом в разделе {accountsLink}.
          </p>
        </section>
      </div>
      <section className={styles.installPanel} aria-labelledby="cabinet-installations">
        <header className={styles.installHeader}>
          <h2 id="cabinet-installations">Мои виджеты</h2>
          <span className={styles.hint}>
            {filtered
              ? `нашли ${results.length} из ${installs.length}`
              : `${installs.length} ${plural(installs.length, 'установка', 'установки', 'установок')}`}
          </span>
          <div className={styles.filters}>
            <label>
              Оплачен до: с
              <input
                type="date"
                aria-label="Оплачен до — с"
                value={from}
                max={to || undefined}
                onChange={(event) =>
                  setFilters({ ...filters, from: event.target.value || undefined })
                }
              />
            </label>
            <label>
              по
              <input
                type="date"
                aria-label="Оплачен до — по"
                value={to}
                min={from || undefined}
                onChange={(event) =>
                  setFilters({ ...filters, to: event.target.value || undefined })
                }
              />
            </label>
            {filtered ? (
              <button type="button" onClick={() => setFilters({})}>
                Сбросить
              </button>
            ) : null}
            <input
              type="search"
              aria-label="Поиск по аккаунту"
              placeholder="ID или название аккаунта"
              value={query}
              onChange={(event) =>
                setFilters({ ...filters, query: event.target.value || undefined })
              }
            />
          </div>
        </header>
        {results.length ? (
          <div className={styles.tableScroll} role="region" aria-label="Установки виджетов">
            <table className={styles.installTable}>
              <colgroup>
                <col />
                <col />
                <col />
                <col />
                <col />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Аккаунт</th>
                  <th scope="col">Виджет</th>
                  <th scope="col">Установлен</th>
                  <th scope="col">Оплачен до</th>
                  <th scope="col">Ваша цена за год</th>
                  <th scope="col" aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {results.map((install) => {
                  const client = findDemoClient(install.account)
                  const paid = install.tier === 'TOP'
                  const request = requests.find(
                    (entry) => entry.account === install.account && entry.widget === install.name,
                  )
                  const order = (partner.cabinetOrders ?? []).find(
                    (entry) => entry.target === install.id && entry.state === 'open',
                  )
                  const canPay =
                    request?.status === 'allowed' || (!request && !requiresPartnerRequest(install))
                  return (
                    <tr key={install.id}>
                      <td>
                        <b>{client?.domain ?? install.account}</b>
                        <small>
                          ID {install.account}
                          {client ? ` · ${client.name}` : ''}
                        </small>
                      </td>
                      <td>
                        <div className={styles.widgetName}>
                          {install.tier ? (
                            <span className={styles.tier} data-tier={install.tier}>
                              {install.tier}
                            </span>
                          ) : null}{' '}
                          {install.name}
                        </div>
                      </td>
                      <td>{install.installed ? dateLabel(install.installed) : '—'}</td>
                      <td>
                        {install.until ? dateLabel(install.until) : '—'}
                        {install.coverage ? (
                          <small>
                            {paid ? (
                              <span
                                className={styles.pill}
                                data-tone={
                                  install.tested || install.coverage.startsWith('тест')
                                    ? 'trial'
                                    : 'paid'
                                }
                              >
                                {install.coverage}
                              </span>
                            ) : (
                              install.coverage
                            )}
                          </small>
                        ) : null}
                      </td>
                      <td>
                        {paid ? (
                          <>
                            <b>{money(cabinetPrice(install))}</b>
                            <small>
                              <s>{money(10000)}</s> ·{' '}
                              {install.paid ? 'продление · −40%' : 'первая оплата · −50%'}
                            </small>
                          </>
                        ) : (
                          <small>{install.tier === 'FREE' ? 'бесплатный' : '—'}</small>
                        )}
                      </td>
                      <td>
                        {paid && partner.approved ? (
                          <div className={styles.rowActions}>
                            {install.tested ? (
                              <small>тест продлён</small>
                            ) : (
                              <button
                                type="button"
                                disabled={!!order}
                                title="Один раз за оплаченный период"
                                onClick={() => onTest(install)}
                              >
                                Тест +7 дн.
                              </button>
                            )}
                            {order ? (
                              <button type="button" onClick={() => onReview(order)}>
                                Ждём оплату {money(order.price - order.bonus)}
                              </button>
                            ) : canPay ? (
                              <button
                                type="button"
                                data-variant="primary"
                                onClick={() => onPay(install)}
                              >
                                Оплатить
                              </button>
                            ) : request ? (
                              <span
                                className={styles.pill}
                                data-tone={request.status === 'pending' ? 'trial' : 'denied'}
                              >
                                {request.status === 'pending'
                                  ? `запрос отправлен ${dateLabel(request.created)}`
                                  : 'оплата через вас недоступна'}
                              </span>
                            ) : (
                              <button type="button" onClick={() => onRequest(install)}>
                                Запросить оплату через меня
                              </button>
                            )}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>
            {filtered
              ? 'Ничего не нашлось. Измените поиск или даты.'
              : 'Пока нет виджетов с вашими номерами. Укажите свой номер в форме активации виджета, чтобы увидеть установку здесь.'}
          </p>
        )}
      </section>
    </>
  )
}
