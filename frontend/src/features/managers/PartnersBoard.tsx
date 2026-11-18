import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { DetailDrawer } from '../../components/DetailDrawer'
import { useAccountDraft } from './AccountDrafts'
import { findDemoClient } from './clientDirectory'
import { can, money, useDemo } from './DemoSession'
import { dateLabel } from './fixtures'
import { usePartnerPaymentRequests, usePartners } from './Partners'
import { makePartner, partnerDirectoryDate, partnerWidgets, type Partner } from './partnerDirectory'
import {
  defaultPartnerFilters,
  partnerPeriods,
  partnerSort,
  type PartnerDirectorySearch,
} from './partnerDirectorySearch'
import styles from './PartnersBoard.module.css'

const day = 86_400_000
const pageSize = 50

function daysBetween(start: string, end: string) {
  return Math.round((Date.parse(end) - Date.parse(start)) / day)
}

function elapsed(date: string) {
  const days = daysBetween(date, partnerDirectoryDate)
  if (!days) return 'сегодня'
  if (days === 1) return 'вчера'
  return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`
}

function plural(n: number, one: string, few: string, many: string) {
  if (n % 100 >= 11 && n % 100 <= 14) return many
  if (n % 10 === 1) return one
  return n % 10 >= 2 && n % 10 <= 4 ? few : many
}

function plusDays(date: string, days: number) {
  return new Date(Date.parse(date) + days * day).toISOString().slice(0, 10)
}

function digits(value: string) {
  const plain = value.replace(/[^0-9]/g, '')
  return plain.length === 11 && /^[78]/.test(plain) ? plain.slice(1) : plain
}

function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className={styles.pill} data-tone={tone}>
      {children}
    </span>
  )
}

function ProStatus({ partner }: { partner: Partner }) {
  const { proTill, proTrial, telegram } = partner
  if (!proTill || proTill < partnerDirectoryDate) {
    return (
      <>
        <Pill tone="off">нет</Pill>
        <small>{proTill ? `закончился ${dateLabel(proTill)}` : 'не подключали'}</small>
      </>
    )
  }
  const days = daysBetween(partnerDirectoryDate, proTill)
  return (
    <>
      <Pill tone={proTrial ? 'trial' : days <= 30 ? 'soon' : 'live'}>
        {proTrial ? 'тест' : 'PRO'} до {dateLabel(proTill).slice(0, 5)}
      </Pill>
      <small data-attention={!telegram && days <= 30}>
        осталось {days} дн.{telegram ? '' : ' · без TG'}
      </small>
    </>
  )
}

function PartnerButton({
  partner,
  open,
  primary = false,
}: {
  partner: Partner
  open: (id: string) => void
  primary?: boolean
}) {
  return (
    <button
      type="button"
      className={styles.textButton}
      data-primary={primary}
      onClick={() => open(partner.id)}
    >
      {partner.name}
    </button>
  )
}

function AccountLink({ id }: { id: string }) {
  const client = findDemoClient(id)
  return client ? (
    <Link to="/managers" search={(previous) => ({ ...previous, section: 'partners', client: id })}>
      {client.domain}
    </Link>
  ) : (
    id
  )
}

function Directory({
  partners,
  sort,
  open,
  changeSort,
}: {
  partners: Partner[]
  sort: PartnerDirectorySearch['sort']
  open: (id: string) => void
  changeSort: () => void
}) {
  return (
    <div className={styles.scroll} role="region" aria-label="Таблица партнёров">
      <table className={styles.directory}>
        <colgroup>
          {[20, 10.2, 12.8, 13.3, 15.4, 9.4, 11.4, 7.5].map((width, i) => (
            <col key={i} style={{ width: `${width}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Партнёр</th>
            <th scope="col" className={styles.numeric}>
              Принёс денег
            </th>
            <th scope="col">Последний платёж</th>
            <th scope="col" title="Может дарить TOP своим клиентам после недавней оплаты виджета">
              Бонус TOP
            </th>
            <th scope="col">Последняя установка</th>
            <th scope="col">Вход в кабинет</th>
            <th scope="col" aria-sort={sort === 'pro' ? 'ascending' : undefined}>
              <button className={styles.textButton} type="button" onClick={changeSort}>
                PRO до{sort === 'pro' ? ' ↑' : ''}
              </button>
            </th>
            <th scope="col" className={styles.numeric}>
              Клиентов
            </th>
          </tr>
        </thead>
        <tbody>
          {partners.map((partner) => {
            const eligible =
              partner.lastWidgetPayment &&
              daysBetween(partner.lastWidgetPayment, partnerDirectoryDate) <= 61
            const paid = partner.lastPayment
            const installed = partner.lastInstall
            return (
              <tr key={partner.id}>
                <td>
                  <PartnerButton partner={partner} open={open} primary />
                  <small title={partner.email}>
                    {[
                      partner.contact,
                      partner.phones[0] &&
                        partner.phones[0] +
                          (partner.phones.length > 1 ? ` (+${partner.phones.length - 1})` : ''),
                      partner.inn && `ИНН ${partner.inn}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </td>
                <td className={styles.numeric}>
                  <span data-muted={!partner.money}>{money(partner.money ?? 0)}</span>
                  {partner.paymentCount ? (
                    <small>
                      {partner.paymentCount}{' '}
                      {plural(partner.paymentCount, 'платёж', 'платежа', 'платежей')}
                    </small>
                  ) : null}
                </td>
                <td>
                  {paid ? (
                    <>
                      {dateLabel(paid[0])}
                      <small>
                        {money(paid[1])} · {elapsed(paid[0])}
                      </small>
                    </>
                  ) : (
                    <span data-muted>не платил</span>
                  )}
                </td>
                <td>
                  <Pill tone={eligible ? 'live' : 'off'}>{eligible ? 'может дарить' : 'нет'}</Pill>
                  <small>
                    {eligible && partner.lastWidgetPayment
                      ? `до ${dateLabel(plusDays(partner.lastWidgetPayment, 61))}`
                      : partner.lastWidgetPayment
                        ? `оплата виджета ${dateLabel(partner.lastWidgetPayment)}`
                        : 'оплат виджетов не было'}
                  </small>
                </td>
                <td>
                  {installed ? (
                    <>
                      {dateLabel(installed[0])}
                      <small title={installed[1]}>
                        {installed[1]} · {elapsed(installed[0])}
                      </small>
                    </>
                  ) : (
                    <span data-muted>не ставил</span>
                  )}
                </td>
                <td>
                  {partner.login ? (
                    <>
                      {dateLabel(partner.login)}
                      <small data-attention={daysBetween(partner.login, partnerDirectoryDate) > 60}>
                        {partner.loginAge ?? elapsed(partner.login)}
                      </small>
                    </>
                  ) : (
                    <span data-muted>не заходил</span>
                  )}
                </td>
                <td>
                  <ProStatus partner={partner} />
                </td>
                <td className={styles.numeric}>
                  {partner.directoryClientCount ?? partner.accounts.length}
                </td>
              </tr>
            )
          })}
          {!partners.length ? (
            <tr>
              <td colSpan={8}>Никого не нашли. Проверьте написание.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

function NewPartner({
  partners,
  add,
  close,
}: {
  partners: Partner[]
  add: (partner: Partner) => void
  close: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const title = useId()
  const [error, setError] = useState('')
  useEffect(() => ref.current?.showModal(), [])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const value = (field: string) => String(form.get(field) ?? '').trim()
    const name = value('name')
    const phone = value('phone')
    const inn = value('inn')
    const key = digits(phone)
    if (!name || key.length !== 10 || !/^\d{10}(?:\d{2})?$/.test(inn)) {
      setError('Введите название, телефон и ИНН из 10 или 12 цифр.')
      return
    }
    if (partners.some((partner) => partner.phones.some((number) => digits(number) === key))) {
      setError('Этот телефон уже указан у партнёра.')
      return
    }
    add({
      ...makePartner(`new-partner-${partners.length + 1}`, name, value('contact')),
      phones: [phone],
      email: value('email'),
      inn,
    })
  }

  return (
    <dialog className={styles.modal} aria-labelledby={title} ref={ref} onClose={close}>
      <header>
        <div>
          <h2 id={title}>Новый партнёр</h2>
          <p>Телефон используется как логин в кабинете.</p>
        </div>
        <button type="button" aria-label="Закрыть" onClick={close}>
          ×
        </button>
      </header>
      <form onSubmit={submit}>
        <label>
          Название
          <input name="name" required placeholder="Компания партнёра" />
        </label>
        <label>
          Контакт
          <input name="contact" placeholder="Имя" />
        </label>
        <div className={styles.formRow}>
          <label>
            Телефон — логин
            <input name="phone" type="tel" required placeholder="+7…" />
          </label>
          <label>
            Почта
            <input name="email" type="email" placeholder="…@…" />
          </label>
        </div>
        <label>
          ИНН
          <input
            name="inn"
            inputMode="numeric"
            maxLength={12}
            required
            placeholder="10 цифр — организация, 12 — ИП"
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <footer>
          <button type="button" onClick={close}>
            Отмена
          </button>
          <button type="submit" data-variant="primary">
            Добавить партнёра
          </button>
        </footer>
      </form>
    </dialog>
  )
}

function PartnerDetails({
  partner,
  open,
  close,
  change,
}: {
  partner: Partner | undefined
  open: boolean
  close: () => void
  change: (partner: Partner) => void
}) {
  const { actor } = useDemo()
  return (
    <DetailDrawer title={partner?.name ?? 'Партнёр'} open={open} onClose={close}>
      {partner ? (
        <div className={styles.detail} key={partner.id}>
          <section>
            <h3>Вход в кабинет</h3>
            <dl>
              <div>
                <dt>Контакт</dt>
                <dd>{partner.contact || '—'}</dd>
              </div>
              <div>
                <dt>Телефон — логин</dt>
                <dd>{partner.phones.join(', ') || '—'}</dd>
              </div>
              <div>
                <dt>Почта</dt>
                <dd>{partner.email || '—'}</dd>
              </div>
              <div>
                <dt>Последний вход</dt>
                <dd>{partner.login ? dateLabel(partner.login) : 'ещё не заходил'}</dd>
              </div>
            </dl>
            <Link
              to="/managers"
              search={{
                section: 'partners',
                client: undefined,
                mode: 'partner',
                partner: partner.id,
              }}
            >
              Открыть партнёрский кабинет
            </Link>
          </section>
          <section>
            <h3>Юрлицо и бонусы</h3>
            <dl>
              <div>
                <dt>Организация</dt>
                <dd>{partner.legal || partner.name}</dd>
              </div>
              <div>
                <dt>ИНН</dt>
                <dd>{partner.inn || '—'}</dd>
              </div>
              <div>
                <dt>Бонусный баланс</dt>
                <dd>{money(partner.bonus)}</dd>
              </div>
              <div>
                <dt>Доступ TOP</dt>
                <dd>{partner.approved ? 'Одобрен' : 'На проверке'}</dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>Клиенты</h3>
            {partner.accounts.length ? (
              <ul>
                {partner.accounts.map((id) => (
                  <li key={id}>
                    <AccountLink id={id} />
                  </li>
                ))}
              </ul>
            ) : (
              <p>Нет закреплённых аккаунтов</p>
            )}
          </section>
          <form
            className={styles.detailForm}
            onSubmit={(event) => {
              event.preventDefault()
              if (!can(actor, 'partners')) return
              const form = new FormData(event.currentTarget)
              change({
                ...partner,
                proTill: String(form.get('until') ?? ''),
                approved: form.has('approved'),
                request: form.has('approved') ? '' : partner.request,
              })
            }}
          >
            <label>
              PRO до <input name="until" type="date" defaultValue={partner.proTill} />
            </label>
            <label>
              <input type="checkbox" name="approved" defaultChecked={partner.approved} /> Одобрить
              доступ TOP
            </label>
            <button type="submit" data-variant="primary">
              Сохранить партнёра
            </button>
          </form>
        </div>
      ) : null}
    </DetailDrawer>
  )
}

export function PartnersBoard() {
  const { actor } = useDemo()
  const [partners, setPartners] = usePartners()
  const [requests, setRequests] = usePartnerPaymentRequests()
  const [reminders, setReminders] = useAccountDraft<Record<string, string>>('/partnerReminders', {})
  const [limit, setLimit] = useState(pageSize)
  const [done, setDone] = useState(false)
  const [selected, setSelected] = useState('')
  const [adding, setAdding] = useState(false)
  const search = useSearch({ from: '/managers' }).partnerDirectory ?? defaultPartnerFilters
  const navigate = useNavigate({ from: '/managers' })
  const tabId = useId()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const byId = new Map(partners.map((partner) => [partner.id, partner]))
  const pendingCount = requests.filter((request) => request.status === 'pending').length
  const visibleRequests = requests.filter((request) => request.status === 'pending' || done)
  const term = search.query.trim().toLocaleLowerCase('ru')
  const number = digits(term)
  const widgetTerm = search.widgetQuery.trim().toLocaleLowerCase('ru')
  const selectedPartner = byId.get(selected)
  const admin = can(actor, 'admin')
  const widgets = partnerWidgets
    .map(([id, account, widget, until, coverage]) => ({
      key: `${id}-${account}-${widget}`,
      partner: byId.get(`directory-${id}`),
      client: findDemoClient(account),
      account,
      widget,
      until,
      coverage,
      left: daysBetween(partnerDirectoryDate, until),
    }))
    .sort((a, b) => a.until.localeCompare(b.until))
  const expiring = widgets.filter((widget) => widget.left <= 30).length
  const inPeriod = (left: number, period: PartnerDirectorySearch['period']) =>
    period === 'all' || (period === 'expired' ? left < 0 : left <= Number(period))
  const partnerRows = partners.filter(
    (partner) =>
      (!term ||
        [partner.name, partner.contact, partner.email, partner.inn, ...partner.phones]
          .join(' ')
          .toLocaleLowerCase('ru')
          .includes(term) ||
        (number.length >= 3 &&
          /^[+()\d\s-]+$/.test(term) &&
          partner.phones.some((phone) => digits(phone).includes(number)))) &&
      (search.sort !== 'payOld' || !!partner.lastPayment),
  )
  if (search.sort) {
    const desc = (a?: string, b?: string) => (b ?? '').localeCompare(a ?? '')
    const pro = (p: Partner) => !!p.proTill && p.proTill >= partnerDirectoryDate
    partnerRows.sort((a, b) => {
      switch (search.sort) {
        case 'money':
          return (b.money ?? 0) - (a.money ?? 0)
        case 'pay':
          return desc(a.lastPayment?.[0], b.lastPayment?.[0])
        case 'payOld':
          return desc(b.lastPayment?.[0], a.lastPayment?.[0])
        case 'inst':
          return desc(a.lastInstall?.[0], b.lastInstall?.[0])
        case 'instOld':
          return desc(b.lastInstall?.[0], a.lastInstall?.[0])
        case 'pro':
          return (
            Number(pro(b)) - Number(pro(a)) ||
            (pro(a) ? desc(b.proTill, a.proTill) : desc(a.proTill, b.proTill))
          )
        case 'login':
          return desc(a.login, b.login)
        case 'loginOld':
          return desc(b.login, a.login)
        default:
          return 0
      }
    })
  }
  const widgetRows = widgets.filter(
    ({ left, partner, client, account, widget }) =>
      inPeriod(left, search.period) &&
      [partner?.name, partner?.contact, client?.domain, client?.name, account, widget]
        .join(' ')
        .toLocaleLowerCase('ru')
        .includes(widgetTerm),
  )

  function setFilters(patch: Partial<PartnerDirectorySearch>, replace = false) {
    setLimit(pageSize)
    void navigate({
      search: (previous) => ({ ...previous, partnerDirectory: { ...search, ...patch } }),
      replace,
    })
  }

  function resolve(id: string, status: 'allowed' | 'denied') {
    if (!admin) return
    setRequests((current) =>
      current.map((request) =>
        request.id === id && request.status === 'pending'
          ? { ...request, status, decidedBy: actor.name, decidedAt: partnerDirectoryDate }
          : request,
      ),
    )
  }

  return (
    <section className={styles.board} aria-labelledby={`${tabId}-heading`}>
      <header className={styles.heading}>
        <div>
          <h1 id={`${tabId}-heading`}>Партнёры</h1>
          <p>
            Справочник: по номеру телефона узнаём партнёра при установке и закрепляем за ним новых
            клиентов. Здесь же — для продлений «оплатил партнёр».
          </p>
          <p>
            Как узнаём продление amoCRM через партнёра: amoCRM продаётся на 6, 8, 10 или 18 мес. и
            дарит 0 / +1 / +2 / +6 мес., а партнёр всегда добавляет ещё +1. Напрямую получается 6,
            9, 12 или 24 мес., через партнёра — 7, 10, 13 или 25. Правила amoCRM постоянные, их не
            настраиваем.
          </p>
        </div>
        {admin ? (
          <button
            className={styles.add}
            type="button"
            data-variant="primary"
            onClick={() => setAdding(true)}
          >
            + Добавить партнёра
          </button>
        ) : (
          <small>Добавлять партнёров может админ</small>
        )}
      </header>
      <div className={styles.tabs} aria-label="Раздел партнёров" role="tablist">
        {(
          [
            ['directory', 'Список партнёров', partners.length],
            ['widgets', 'Виджеты партнёров', expiring],
          ] as const
        ).map(([tab, label, count], i) => (
          <button
            key={tab}
            ref={(button) => {
              tabRefs.current[i] = button
            }}
            id={`${tabId}-${tab}`}
            type="button"
            role="tab"
            tabIndex={search.tab === tab ? 0 : -1}
            aria-selected={search.tab === tab}
            aria-controls={`${tabId}-panel`}
            onClick={() => setFilters({ tab })}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const target = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - i
              tabRefs.current[target]?.focus()
              setFilters({ tab: target ? 'widgets' : 'directory' })
            }}
          >
            {label}{' '}
            <span className={styles.badge} data-alert={tab === 'widgets' && count > 0}>
              {count}
            </span>
          </button>
        ))}
      </div>
      <div
        className={styles.tabPanel}
        role="tabpanel"
        id={`${tabId}-panel`}
        aria-labelledby={`${tabId}-${search.tab}`}
      >
        {search.tab === 'directory' ? (
          <>
            <section className={styles.card} aria-label="Запросы на оплату через партнёра">
              <header className={styles.cardHead}>
                <h2>Запросы на оплату через партнёра</h2>
                <span className={styles.badge} data-alert={pendingCount > 0}>
                  {pendingCount}
                </span>
                <small>
                  клиент раньше платил нам 100% сам, а теперь виджет закреплён за партнёром — оплата
                  со скидкой из кабинета закрыта, пока вы не разрешите · о новом запросе приходит
                  оповещение в Telegram
                </small>
              </header>
              <div className={styles.scroll} role="region" aria-label="Таблица запросов">
                <table className={styles.requests}>
                  <colgroup>
                    {[12, 14, 14, 22, 19, 19].map((width, i) => (
                      <col key={i} style={{ width: `${width}%` }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      {[
                        'Запрос',
                        'Партнёр',
                        'Аккаунт',
                        'Виджет',
                        'Как клиент платил раньше',
                        '',
                      ].map((title, i) => (
                        <th key={i} scope="col">
                          {title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRequests.map((request) => {
                      const partner = byId.get(request.partner)
                      return (
                        <tr key={request.id}>
                          <td>
                            {dateLabel(request.created)}
                            <small>{elapsed(request.created)}</small>
                          </td>
                          <td>
                            {partner ? (
                              <>
                                <PartnerButton partner={partner} open={setSelected} />
                                <small>{partner.contact}</small>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            <AccountLink id={request.account} />
                            <small>Клиент партнёра</small>
                          </td>
                          <td>
                            <span className={styles.topTier}>TOP</span> {request.widget}
                          </td>
                          <td>
                            <span className={styles.priorPayment}>
                              {money(request.previousAmount)} · {request.previousSource} ·{' '}
                              {dateLabel(request.previousDate)}
                            </span>
                            <small>сам, полная цена</small>
                          </td>
                          <td className={styles.numeric}>
                            {request.status !== 'pending' ? (
                              <small>
                                {request.status === 'allowed' ? 'разрешено' : 'отказано'} ·{' '}
                                {request.decidedBy} · {dateLabel(request.decidedAt ?? '')}
                              </small>
                            ) : admin ? (
                              <div className={styles.actions}>
                                <button
                                  type="button"
                                  data-variant="primary"
                                  onClick={() => resolve(request.id, 'allowed')}
                                >
                                  Разрешить
                                </button>
                                <button type="button" onClick={() => resolve(request.id, 'denied')}>
                                  Отказать
                                </button>
                              </div>
                            ) : (
                              <small>решает админ</small>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {!visibleRequests.length ? (
                      <tr>
                        <td colSpan={6}>Новых запросов нет</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <footer>
                <button
                  className={styles.textButton}
                  type="button"
                  aria-expanded={done}
                  onClick={() => setDone(!done)}
                >
                  {done ? 'Скрыть решённые' : `Решённые: ${requests.length - pendingCount}`}
                </button>
              </footer>
            </section>
            <div className={styles.toolbar}>
              <span>
                {term ? 'Нашли' : 'Всего'} {partnerRows.length}{' '}
                {plural(partnerRows.length, 'партнёр', 'партнёра', 'партнёров')}
              </span>
              <div>
                <label>
                  Сортировка{' '}
                  <select
                    value={search.sort}
                    onChange={(event) =>
                      setFilters({
                        sort: partnerSort.find(([key]) => key === event.target.value)?.[0] ?? '',
                      })
                    }
                  >
                    {partnerSort.map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  type="search"
                  aria-label="Поиск партнёра"
                  placeholder="Название, имя, телефон, почта или ИНН"
                  value={search.query}
                  onChange={(event) => setFilters({ query: event.target.value }, true)}
                />
              </div>
            </div>
            <section className={styles.card} aria-label="Справочник партнёров">
              <Directory
                partners={partnerRows.slice(0, limit)}
                sort={search.sort}
                open={setSelected}
                changeSort={() => setFilters({ sort: search.sort === 'pro' ? '' : 'pro' })}
              />
              {partnerRows.length > limit ? (
                <footer className={styles.more}>
                  <button type="button" onClick={() => setLimit(limit + pageSize)}>
                    Показать ещё {Math.min(pageSize, partnerRows.length - limit)}
                  </button>
                </footer>
              ) : null}
            </section>
          </>
        ) : (
          <>
            <div className={styles.toolbar}>
              <div className={styles.periods} role="group" aria-label="Срок действия">
                {partnerPeriods.map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    aria-pressed={search.period === key}
                    onClick={() => setFilters({ period: key })}
                  >
                    {label} {widgets.filter((widget) => inPeriod(widget.left, key)).length}
                  </button>
                ))}
              </div>
              <input
                type="search"
                aria-label="Поиск по виджетам партнёров"
                placeholder="Партнёр, аккаунт, ID или виджет"
                value={search.widgetQuery}
                onChange={(event) => setFilters({ widgetQuery: event.target.value }, true)}
              />
            </div>
            <section className={styles.card} aria-label="Сроки виджетов">
              <header className={styles.cardHead}>
                <h2>
                  {search.period === 'all'
                    ? 'Все платные виджеты партнёров'
                    : search.period === 'expired'
                      ? 'Истекли — у клиента не оплачено'
                      : `Заканчиваются в ближайшие ${search.period} дней (и уже истекшие)`}
                </h2>
                <span className={styles.badge}>{widgetRows.length}</span>
                <small>
                  сверху — что заканчивается раньше · партнёру уходят автонапоминания в Telegram /
                  Max за 14, 3 и 1 день · отметьте, когда напомнили сами
                </small>
              </header>
              <div className={styles.scroll} role="region" aria-label="Таблица сроков">
                <table className={styles.expiry}>
                  <thead>
                    <tr>
                      {[
                        'Оплачен до ↑',
                        'Партнёр',
                        'Аккаунт клиента',
                        'Виджет',
                        'Чем покрыт',
                        'Напоминание',
                      ].map((title) => (
                        <th key={title} scope="col">
                          {title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {widgetRows
                      .slice(0, limit)
                      .map(({ key, partner, client, account, widget, until, coverage, left }) => (
                        <tr key={key}>
                          <td>
                            <b>{dateLabel(until)}</b>
                            <small data-attention={left <= 30}>
                              {left < 0
                                ? `истёк ${elapsed(until)}`
                                : left === 0
                                  ? 'заканчивается сегодня'
                                  : `через ${left} ${plural(left, 'день', 'дня', 'дней')}`}
                            </small>
                          </td>
                          <td>
                            {partner ? (
                              <>
                                <PartnerButton partner={partner} open={setSelected} />
                                <small>
                                  {partner.contact} · {partner.phones[0]}
                                </small>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            <AccountLink id={account} />
                            <small>
                              {client?.name} · ID {account}
                            </small>
                          </td>
                          <td>
                            <span className={styles.topTier}>TOP</span> {widget}
                          </td>
                          <td>
                            <Pill
                              tone={
                                left < 0 ? 'soon' : coverage.includes('тест') ? 'trial' : 'live'
                              }
                            >
                              {coverage}
                            </Pill>
                          </td>
                          <td>
                            <div className={styles.actions}>
                              <small>
                                {reminders[key]
                                  ? `напомнил ${reminders[key]} · ${dateLabel(partnerDirectoryDate)}`
                                  : 'ещё не напоминали'}
                              </small>
                              <button
                                type="button"
                                onClick={() =>
                                  setReminders((entries) => ({ ...entries, [key]: actor.name }))
                                }
                              >
                                {reminders[key] ? 'Ещё раз' : 'Напомнил'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    {!widgetRows.length ? (
                      <tr>
                        <td colSpan={6}>
                          Ничего не заканчивается в этот период. Выберите период шире.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {widgetRows.length > limit ? (
                <footer className={styles.more}>
                  <button type="button" onClick={() => setLimit(limit + pageSize)}>
                    Показать ещё {Math.min(pageSize, widgetRows.length - limit)}
                  </button>
                </footer>
              ) : null}
            </section>
          </>
        )}
      </div>
      {adding && admin ? (
        <NewPartner
          partners={partners}
          close={() => setAdding(false)}
          add={(partner) => {
            setPartners((current) => [...current, partner])
            setAdding(false)
            setFilters({ tab: 'directory', sort: '', query: partner.name })
          }}
        />
      ) : null}
      <PartnerDetails
        partner={selectedPartner}
        open={!!selectedPartner}
        close={() => setSelected('')}
        change={(partner) => {
          setPartners((current) => current.map((item) => (item.id === partner.id ? partner : item)))
          setSelected('')
        }}
      />
    </section>
  )
}
