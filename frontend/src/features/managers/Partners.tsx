import { useState } from 'react'
import { Link, useSearch, useNavigate } from '@tanstack/react-router'
import { Panel, Table } from './AccountPanel'
import { useAccountDraft } from './AccountDrafts'
import { boards, dateLabel } from './fixtures'
import { demoClients, findDemoClient } from './clientDirectory'
import {
  partnerDirectoryDate,
  partnerPaymentRequests,
  partnerWidgets,
  seedPartners,
  type Partner,
} from './partnerDirectory'
import { cellText, money, today, useDemo } from './DemoSession'
import styles from './AccountPanels.module.css'
import page from './ManagersPage.module.css'

export type { Partner } from './partnerDirectory'

export function usePartners() {
  return useAccountDraft<Partner[]>('/partners', seedPartners)
}

export function usePartnerPaymentRequests() {
  return useAccountDraft('/partnerPaymentRequests', partnerPaymentRequests)
}

const views = [
  'Мои виджеты',
  'Аккаунты',
  'Мои клиенты',
  'Промокоды',
  'Наши виджеты',
  'Уведомления',
  'Бонусы и операции',
] as const
export function PartnerEntry() {
  return <PartnerWorkspace />
}
function PartnerWorkspace() {
  const { state } = useDemo()
  const { view, partner: requestedPartner } = useSearch({ from: '/managers' })
  const navigate = useNavigate()
  const [partners, setPartners] = usePartners()
  const [paymentRequests] = usePartnerPaymentRequests()
  const partnerId =
    requestedPartner && partners.some((p) => p.id === requestedPartner)
      ? requestedPartner
      : 'partner-1'
  const partner = partners.find((p) => p.id === partnerId)!
  const [message, setMessage] = useState('')
  const currentView = views.find((v) => v === view) ?? 'Мои виджеты'
  const asOf = partner.id.startsWith('directory-') ? partnerDirectoryDate : today
  const pro = !!partner.proTill && partner.proTill >= asOf
  const mine = demoClients.filter((c) => partner.accounts.includes(c.id))
  const ownRequests = paymentRequests.filter((r) => r.partner === partnerId)
  const cabinetOptions = partners.filter((p) => p.id.startsWith('partner-') || p.id === partnerId)
  const snapshots = partnerWidgets.filter(
    ([index, account]) => `directory-${index}` === partnerId && partner.accounts.includes(account),
  )
  const requestStatus = {
    allowed: 'Оплата через партнёра разрешена',
    denied: 'Оплата через партнёра недоступна',
    pending: 'Запрос отправлен',
  } as const

  const update = (patch: Partial<Partner>) =>
    setPartners((ps) => ps.map((p) => (p.id === partnerId ? { ...p, ...patch } : p)))
  return (
    <div className={page.shell} data-menu-open="true" data-mobile-open="true" data-partner="true">
      <header className={page.topbar}>
        <strong>Ракурс · Партнёрский кабинет</strong>
        <label>
          Демо-партнёр
          <select
            value={partnerId}
            onChange={(e) => {
              void navigate({
                to: '/managers',
                search: {
                  section: 'partners',
                  client: undefined,
                  mode: 'partner',
                  view,
                  partner: e.target.value,
                },
              })
              setMessage('')
            }}
          >
            {cabinetOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <Link to="/managers" search={{ section: 'partners', client: undefined }}>
          Кабинет менеджера
        </Link>
        <Link to="/login" search={{ next: undefined }}>
          Сменить кабинет
        </Link>
      </header>
      <aside className={page.sidebar}>
        <nav className={page.menu} aria-label="Разделы партнёра">
          {views.map((v) => (
            <Link
              key={v}
              to="/managers"
              search={{
                section: 'partners',
                client: undefined,
                mode: 'partner',
                view: v,
                partner: partnerId,
              }}
              aria-current={v === currentView ? 'page' : undefined}
            >
              {v}
            </Link>
          ))}
        </nav>
      </aside>
      <main className={page.main}>
        <div className={page.demo}>
          Демо-данные. Только клиенты выбранного партнёра; действия не отправляются во внешние
          системы.
        </div>
        <h1>{currentView}</h1>
        {message ? <p role="status">{message}</p> : null}
        {currentView === 'Мои виджеты' ? (
          <div className={styles.stack}>
            <Panel title={partner.name}>
              <p>
                Клиентов: {mine.length}. Бонусы: {money(partner.bonus)}.
              </p>
              <p>{pro ? `PRO до ${dateLabel(partner.proTill)}` : 'Базовый кабинет'}</p>
            </Panel>
            <Panel title="Доступ TOP">
              <p>{partner.approved ? 'Заявка одобрена' : partner.request || 'Заявка не подана'}</p>
              {!partner.approved ? (
                <button
                  type="button"
                  disabled={!!partner.request}
                  onClick={() => {
                    update({ request: 'Доступ TOP' })
                    setMessage('Заявка отправлена на демо-проверку')
                  }}
                >
                  Запросить доступ TOP
                </button>
              ) : null}
            </Panel>
          </div>
        ) : null}
        {currentView === 'Аккаунты' ? (
          <Panel title="Аккаунты с нашими виджетами">
            <Table
              columns={['Аккаунт', 'Клиент', 'Лицензия до']}
              rows={mine.map((c) => ({ id: c.id, cells: [c.domain, c.name, dateLabel(c.till)] }))}
            />
          </Panel>
        ) : null}
        {currentView === 'Мои виджеты' ? (
          <Table
            columns={['Аккаунт', 'Виджет', 'Оплачен до']}
            rows={[
              ...state.rows
                .filter((r) => partner.accounts.includes(r.client ?? ''))
                .map((r) => ({
                  id: r.id,
                  cells: [
                    r.client ?? '—',
                    cellText(r.cells[1]),
                    r.paidUntil ? cellText(r.paidUntil) : '—',
                  ],
                })),
              ...snapshots.map(([, account, widget, until]) => {
                const request = ownRequests.find(
                  (r) => r.account === account && r.widget === widget,
                )
                return {
                  id: account + widget,
                  cells: [
                    findDemoClient(account)?.domain ?? account,
                    request ? { text: widget, note: requestStatus[request.status] } : widget,
                    dateLabel(until),
                  ],
                }
              }),
            ]}
          />
        ) : null}
        {currentView === 'Мои клиенты' ? (
          pro ? (
            <Table
              columns={['Аккаунт', 'Клиент', 'Лицензия до', 'Пользователей']}
              rows={mine.map((c) => ({
                id: c.id,
                cells: [c.domain, c.name, dateLabel(c.till), c.seats],
              }))}
            />
          ) : (
            <Panel title="Нужен PRO">
              <p>Список клиентов и контакты доступны при активном PRO.</p>
            </Panel>
          )
        ) : null}
        {currentView === 'Наши виджеты' ? (
          <Table
            columns={['Виджет', 'Линейка', 'Установки ваших клиентов']}
            rows={boards.widgets.rows.map((w) => ({
              id: w.id,
              cells: [
                cellText(w.cells[0]),
                typeof w.cells[0] === 'object' ? (w.cells[0].line ?? '—') : '—',
                String(
                  state.rows.filter(
                    (r) =>
                      partner.accounts.includes(r.client ?? '') &&
                      cellText(r.cells[1]) === cellText(w.cells[0]),
                  ).length,
                ),
              ],
            }))}
          />
        ) : null}
        {currentView === 'Промокоды' ? (
          <Panel title="Промокоды PRO">
            <ul>
              {partner.promos.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
            <form
              className={styles.peopleForm}
              onSubmit={(e) => {
                e.preventDefault()
                if (!pro) return
                const code = String(new FormData(e.currentTarget).get('code')).trim().toUpperCase()
                if (partners.some((p) => p.promos.includes(code))) {
                  setMessage('Такой промокод уже существует')
                  return
                }
                update({ promos: [...partner.promos, code] })
                e.currentTarget.reset()
                setMessage('Промокод создан')
              }}
            >
              <label>
                Промокод
                <input name="code" required pattern="[A-Za-z0-9-]{3,24}" disabled={!pro} />
              </label>
              <button type="submit" disabled={!pro}>
                Создать промокод
              </button>
            </form>
            {!pro ? <p>Для промокодов нужен активный PRO.</p> : null}
          </Panel>
        ) : null}
        {currentView === 'Бонусы и операции' ? (
          <Panel title={`Бонусный баланс ${money(partner.bonus)}`}>
            <p>Бонусы используются для скидки. Денежного пополнения нет.</p>
            {partner.operations.length ? (
              <ul>
                {partner.operations.map((op, i) => (
                  <li key={i}>{op}</li>
                ))}
              </ul>
            ) : (
              <p>Операций в демо-сессии пока нет.</p>
            )}
          </Panel>
        ) : null}
        {currentView === 'Бонусы и операции' ? (
          <Panel title={pro ? `PRO до ${dateLabel(partner.proTill)}` : 'Подключить PRO'}>
            <p>Демо-год PRO — 12 000 бонусов. Срок добавляется к действующему.</p>
            <button
              type="button"
              disabled={partner.bonus < 12000}
              onClick={() => {
                if (partner.bonus < 12000) return
                const base = new Date((pro ? partner.proTill : asOf) + 'T00:00:00Z')
                base.setUTCFullYear(base.getUTCFullYear() + 1)
                const until = base.toISOString().slice(0, 10)
                update({
                  bonus: partner.bonus - 12000,
                  proTill: until,
                  proTrial: false,
                  operations: [
                    `PRO до ${dateLabel(until)} · −12 000 бонусов · без денежного платежа`,
                    ...partner.operations,
                  ],
                })
                setMessage('PRO продлён в демо')
              }}
            >
              Продлить PRO за бонусы
            </button>
            {partner.bonus < 12000 ? (
              <p>Недостаточно бонусов. Внешняя оплата в демо недоступна.</p>
            ) : null}
          </Panel>
        ) : null}
        {currentView === 'Уведомления' ? (
          <Panel title="Уведомления и реквизиты">
            <p>
              {partner.approved
                ? 'Доступ TOP одобрен. Новых уведомлений нет.'
                : partner.request
                  ? 'Заявка ожидает решения менеджера.'
                  : 'Заявок пока нет.'}
            </p>
            {ownRequests.length ? (
              <ul>
                {ownRequests.map((request) => (
                  <li key={request.id}>
                    {findDemoClient(request.account)?.domain ?? request.account} · {request.widget}{' '}
                    · {requestStatus[request.status]}
                  </li>
                ))}
              </ul>
            ) : null}
            <form
              className={styles.stack}
              onSubmit={(e) => {
                e.preventDefault()
                update({ legal: String(new FormData(e.currentTarget).get('legal')).trim() })
                setMessage('Реквизиты сохранены в демо')
              }}
              key={partner.id}
            >
              <label>
                Наименование компании
                <input name="legal" required defaultValue={partner.legal} />
              </label>
              <button type="submit">Сохранить реквизиты</button>
            </form>
          </Panel>
        ) : null}
      </main>
    </div>
  )
}
