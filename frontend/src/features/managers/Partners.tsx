import { useState } from 'react'
import { Link, useSearch, useNavigate } from '@tanstack/react-router'
import { DetailDrawer } from '../../components/DetailDrawer'
import { Panel, Table, Filters } from './AccountPanel'
import { useAccountDraft } from './AccountDrafts'
import { boards, clients, dateLabel } from './fixtures'
import { can, cellText, money, today, useDemo } from './DemoSession'
import styles from './AccountPanels.module.css'
import page from './ManagersPage.module.css'

export type Partner = {
  id: string
  name: string
  accounts: string[]
  proTill: string
  bonus: number
  approved: boolean
  promos: string[]
  request: string
  operations: string[]
  legal: string
}
const seedPartners: Partner[] = boards.partners.rows.map((r, i) => ({
  id: r.id,
  name: cellText(r.cells[0]),
  accounts: i === 0 ? ['91001002'] : i === 1 ? ['91001005'] : [],
  proTill: i === 2 ? '' : '2027-03-31',
  bonus: i === 0 ? 48200 : 1200,
  approved: i !== 1,
  promos: [],
  request: i === 1 ? 'Доступ TOP' : '',
  operations: [],
  legal: '',
}))
export function usePartners() {
  return useAccountDraft<Partner[]>('/partners', seedPartners)
}

export function PartnersBoard() {
  const { actor } = useDemo()
  const [partners, setPartners] = usePartners()
  const [filter, setFilter] = useState('Все')
  const [selected, setSelected] = useState('')
  const current = partners.find((p) => p.id === selected)
  const rows = partners.filter((p) =>
    filter === 'Все' || filter === 'Заявки'
      ? filter === 'Все' || !!p.request
      : !p.proTill || p.proTill <= '2026-12-16',
  )
  return (
    <>
      <h1>Партнёры</h1>
      <Filters
        filters={['Все', 'Заявки', 'Истекает PRO'].map((label) => ({ label }))}
        active={filter}
        change={setFilter}
      />
      <Table
        columns={['Партнёр', 'Клиентов', 'PRO до', 'Бонусы']}
        rows={rows.map((p) => ({
          id: p.id,
          cells: [
            p.name,
            String(p.accounts.length),
            p.proTill ? dateLabel(p.proTill) : '—',
            money(p.bonus),
          ],
        }))}
      />
      <div className={styles.stack}>
        {rows.map((p) => (
          <Panel
            key={p.id}
            title={p.name}
            hint={`${p.accounts.length} клиентов · бонусы ${money(p.bonus)}`}
            action={
              <button type="button" onClick={() => setSelected(p.id)}>
                Открыть партнёра
              </button>
            }
          >
            <p>
              PRO: {p.proTill ? `до ${dateLabel(p.proTill)}` : 'Не подключён'} ·{' '}
              {p.approved ? 'Одобрен' : 'На проверке'}
            </p>
            {p.request ? <p>Заявка: {p.request}</p> : null}
          </Panel>
        ))}
      </div>
      <DetailDrawer
        title={current?.name ?? 'Партнёр'}
        open={!!current}
        onClose={() => setSelected('')}
      >
        {current ? (
          <>
            <p>Баланс {money(current.bonus)}. Клиенты закреплены за партнёром.</p>
            <Link
              to="/managers"
              search={{
                section: 'partners',
                client: undefined,
                mode: 'partner',
                partner: current.id,
              }}
            >
              Открыть партнёрский кабинет
            </Link>
            {current.accounts.map((id) => (
              <p key={id}>
                <Link to="/managers" search={{ section: 'partners', client: id }}>
                  {clients.find((c) => c.id === id)?.name ?? id}
                </Link>
              </p>
            ))}
            <form
              className={styles.stack}
              onSubmit={(e) => {
                e.preventDefault()
                if (!can(actor, 'partners')) return
                const f = new FormData(e.currentTarget)
                setPartners((ps) =>
                  ps.map((p) =>
                    p.id === current.id
                      ? {
                          ...p,
                          proTill: String(f.get('until')),
                          approved: f.has('approved'),
                          request: f.has('approved') ? '' : p.request,
                        }
                      : p,
                  ),
                )
                setSelected('')
              }}
            >
              <label>
                PRO до
                <input name="until" type="date" defaultValue={current.proTill} />
              </label>
              <label>
                <input type="checkbox" name="approved" defaultChecked={current.approved} /> Одобрить
                доступ TOP
              </label>
              <button type="submit">Сохранить партнёра</button>
            </form>
          </>
        ) : null}
      </DetailDrawer>
    </>
  )
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
  const partnerId =
    requestedPartner && partners.some((p) => p.id === requestedPartner)
      ? requestedPartner
      : 'partner-1'
  const partner = partners.find((p) => p.id === partnerId)!
  const [message, setMessage] = useState('')
  const currentView = views.find((v) => v === view) ?? 'Мои виджеты'
  const pro = !!partner.proTill && partner.proTill >= today
  const mine = clients.filter((c) => partner.accounts.includes(c.id))
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
            {partners.map((p) => (
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
            rows={state.rows
              .filter((r) => partner.accounts.includes(r.client ?? ''))
              .map((r) => ({
                id: r.id,
                cells: [
                  r.client ?? '—',
                  cellText(r.cells[1]),
                  r.paidUntil ? cellText(r.paidUntil) : '—',
                ],
              }))}
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
                const base = new Date((pro ? partner.proTill : today) + 'T00:00:00Z')
                base.setUTCFullYear(base.getUTCFullYear() + 1)
                const until = base.toISOString().slice(0, 10)
                update({
                  bonus: partner.bonus - 12000,
                  proTill: until,
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
