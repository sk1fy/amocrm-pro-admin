import { useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { DetailDrawer } from '../../components/DetailDrawer'
import { useAccountDraft, useReadAccountDraft } from './AccountDrafts'
import {
  demoClients,
  directoryDate,
  type ClientHealth,
  type RenewalChannel,
} from './clientDirectory'
import {
  portraitConditions,
  type ClientDirectorySearch,
  type DirectoryBucket,
  type PortraitCondition,
  type PortraitFilter,
} from './clientDirectorySearch'
import { dateLabel, type DemoRow } from './fixtures'
import { today, useDemo } from './DemoSession'
import { getMarketAccounts, getMarketWidget } from './marketFixtures'
import { portraitTopics } from './portraitTopics'
import { usePartners } from './Partners'
import styles from './ClientsBoard.module.css'

const cards: { id: DirectoryBucket; label: string; hint: string }[] = [
  { id: 'all', label: 'все аккаунты', hint: 'Всего в системе' },
  { id: 'green', label: 'получаем данные', hint: 'Есть активный виджет' },
  { id: 'red', label: 'нет данных', hint: 'Данные могут быть устаревшими' },
  {
    id: 'inactive',
    label: 'не пользуются amoCRM',
    hint: 'Лицензия истекла или действует запрет работы',
  },
  { id: 'banned', label: 'запрет работы', hint: 'тестовые: наши и модераторов amoCRM' },
  { id: 'trial', label: 'пробный период amoCRM', hint: 'Срок пробного периода по данным amoCRM' },
]

const owners = [
  { value: 'Наш клиент', label: 'Наш клиент', plural: 'Наши клиенты', tone: 'green' },
  { value: 'Свободный клиент', label: 'Свободный клиент', plural: 'Свободные', tone: 'inactive' },
  {
    value: 'Клиент партнёра',
    label: 'Клиент партнёра',
    plural: 'Клиенты партнёров',
    tone: 'partner',
  },
  { value: 'Запрет работы', label: 'Запрет работы', plural: 'Запрет работы', tone: 'banned' },
]

const healthLabels = {
  green: 'Получаем данные',
  red: 'Нет данных',
  expired: 'Лицензия истекла',
  banned: 'Запрет работы',
}

const renewalLabels: Record<RenewalChannel, string> = {
  partner: 'через партнёра',
  direct: 'напрямую',
  unknown: 'неизвестно',
}

const tariffs = [...new Set(demoClients.map((client) => client.tariff))].sort((a, b) =>
  a.localeCompare(b, 'ru'),
)

const columns = [
  'ID amoCRM',
  'Название',
  'amoCRM до ↑',
  'Тариф',
  'Пользователей',
  'Чей клиент',
  'Данные обновлены',
]

const warmLabels = {
  told: 'рассказали',
  installed: 'стоит',
  shown: 'показали',
  using: 'пользуется',
} as const

type DirectoryClient = (typeof demoClients)[number]

function daysLeft(client: DirectoryClient) {
  return (Date.parse(client.till) - Date.parse(client.reference ? directoryDate : today)) / 86400000
}

function inBucket(client: DirectoryClient, health: ClientHealth, bucket: DirectoryBucket) {
  if (bucket === 'all') return true
  if (bucket === 'trial') return client.tariff === 'Пробный период' && daysLeft(client) >= 0
  if (bucket === 'inactive') return health === 'expired' || health === 'banned'
  return health === bucket
}

function includes(text: string, query: string) {
  return text.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))
}

function matchesPortrait(
  client: DirectoryClient,
  filter: PortraitFilter,
  accountNote: string,
  rows: readonly DemoRow[],
  read: ReturnType<typeof useReadAccountDraft>,
) {
  const niche = read(client.id, 'niche', client.domain === 'sever-logistics' ? 'Логистика' : '')
  const answers = read<Record<string, { note?: string; answer?: string }>>(client.id, 'answers', {})
  const people = read<{ name: string }[]>(client.id, 'people', [])
  const warmth = read<Record<string, string[]>>(client.id, 'warmth', {})[filter.topic] ?? []
  const { note, answer } = answers[filter.topic] ?? {}
  const audit = read(client.id, 'audit', false)
  const inPeriod = (!filter.from || filter.from <= today) && (!filter.to || filter.to >= today)
  if (filter.niche && !includes(niche, filter.niche)) return false
  if (
    filter.query &&
    ![
      niche,
      accountNote,
      read(client.id, 'site', ''),
      ...people.map((person) => person.name),
      ...Object.values(answers).map((item) => item.note ?? ''),
    ].some((text) => includes(text, filter.query))
  )
    return false

  switch (filter.condition) {
    case '':
      return true
    case 'unknown':
      return !note?.trim() && (!answer || answer === 'неизвестно')
    case 'yes':
      return answer === 'да'
    case 'no':
      return answer === 'нет'
    case 'audited':
      return audit && inPeriod
    case 'unaudited':
      return !audit
    case 'cold':
      return warmth.length === 0
    case 'expires':
      return Math.abs(daysLeft(client)) <= 30
    case 'noFree':
      return (
        !client.hasFree &&
        !rows.some(
          (row) =>
            row.client === client.id &&
            typeof row.cells[1] === 'object' &&
            row.cells[1].line === 'FREE',
        )
      )
    default:
      return inPeriod && warmth.includes(warmLabels[filter.condition])
  }
}

function PortraitDialog({
  filter,
  close,
  apply,
}: {
  filter: PortraitFilter | undefined
  close: () => void
  apply: (filter: PortraitFilter) => void
}) {
  const [topics] = useAccountDraft('/portraitTopics', portraitTopics)
  return (
    <DetailDrawer title="Клиенты по портрету" open onClose={close}>
      <form
        className={styles.portraitForm}
        onSubmit={(event) => {
          event.preventDefault()
          const values = new FormData(event.currentTarget)
          apply({
            topic: String(values.get('topic') ?? ''),
            condition: String(values.get('condition') ?? '') as PortraitCondition,
            niche: String(values.get('niche') ?? '').trim(),
            query: String(values.get('query') ?? '').trim(),
            from: String(values.get('from') ?? ''),
            to: String(values.get('to') ?? ''),
          })
        }}
      >
        <p>Поиск по темам, отметкам и тексту заметок клиента.</p>
        <label>
          Тема
          <select name="topic" defaultValue={filter?.topic ?? topics[0]?.id}>
            {topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Условие
          <select name="condition" defaultValue={filter?.condition ?? 'unknown'}>
            <option value="">любое — только поиск по тексту</option>
            {Object.entries(portraitConditions).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.datePair}>
          <label>
            Дата отметки или аудита с
            <input type="date" name="from" defaultValue={filter?.from} />
          </label>
          <label>
            по
            <input type="date" name="to" defaultValue={filter?.to} />
          </label>
        </div>
        <label>
          Ниша
          <input name="niche" placeholder="любая" defaultValue={filter?.niche} />
        </label>
        <label>
          Текст в заметках
          <input name="query" placeholder="например, Tilda" defaultValue={filter?.query} />
        </label>
        <button data-variant="primary" type="submit">
          Показать клиентов
        </button>
      </form>
    </DetailDrawer>
  )
}

export function ClientsBoard() {
  const { directory: filters = {}, market } = useSearch({ from: '/managers' })
  const navigate = useNavigate({ from: '/managers' })
  const { state } = useDemo()
  const [partners] = usePartners()
  const read = useReadAccountDraft()
  const [limit, setLimit] = useState(60)
  const [portraitOpen, setPortraitOpen] = useState(false)
  const marketAccounts = market ? new Set(getMarketAccounts(market)) : undefined
  const bucket = filters.bucket ?? (market ? 'all' : 'green')

  function change(patch: ClientDirectorySearch) {
    setLimit(60)
    void navigate({
      search: (previous) => ({ ...previous, directory: { ...previous.directory, ...patch } }),
      replace: true,
    })
  }

  function reset() {
    setLimit(60)
    void navigate({
      search: { section: 'clients', client: undefined, directory: { bucket: 'all' } },
    })
  }

  const partnerNames = new Map<string, string>()
  for (const partner of partners) {
    for (const id of partner.accounts) partnerNames.set(id, partner.name)
  }

  const records = demoClients.map((client) => {
    const account = state.accounts[client.id]
    const owner = owners.find((item) => item.value === account.owner)
    const health: ClientHealth =
      account.owner === 'Запрет работы'
        ? 'banned'
        : client.bucket === 'banned'
          ? 'red'
          : client.bucket
    const renewal = account.owner === 'Наш клиент' ? 'partner' : client.renewal
    const partner = owner?.tone === 'partner' ? partnerNames.get(client.id) || client.partner : ''
    return { client, account, owner, health, renewal, partner }
  })

  const { query, portrait } = filters
  const portraitLabel = portrait
    ? [portrait.condition && portraitConditions[portrait.condition], portrait.niche, portrait.query]
        .filter(Boolean)
        .join(' · ')
    : ''
  const visible = records
    .filter(
      ({ account, client, health, renewal, partner }) =>
        inBucket(client, health, bucket) &&
        (!filters.owner || account.owner === filters.owner) &&
        (!query ||
          [client.id, client.domain, client.name, partner].some((text) => includes(text, query))) &&
        (!filters.tariff || client.tariff === filters.tariff) &&
        (!filters.from || client.till >= filters.from) &&
        (!filters.to || client.till <= filters.to) &&
        (!filters.renewal || renewal === filters.renewal) &&
        (!marketAccounts || marketAccounts.has(client.id)) &&
        (!portrait || matchesPortrait(client, portrait, account.note, state.rows, read)),
    )
    .sort((left, right) => left.client.till.localeCompare(right.client.till))

  return (
    <section className={styles.section}>
      <header className={styles.heading}>
        <h1>Клиенты</h1>
        <p>
          Все аккаунты amoCRM, где стоят или стояли наши виджеты. Сверху — у кого лицензия amoCRM
          заканчивается раньше. Нажмите на аккаунт или ID, чтобы открыть карточку.
        </p>
      </header>
      <div className={styles.cards} role="group" aria-label="Состояние аккаунтов">
        {cards.map((card) => {
          const inGroup = records.filter(({ client, health }) => inBucket(client, health, card.id))
          return (
            <div
              className={styles.card}
              data-selected={bucket === card.id && (card.id !== 'all' || !!filters.owner)}
              key={card.id}
            >
              <button
                className={styles.cardButton}
                type="button"
                title={card.hint}
                aria-pressed={bucket === card.id && !filters.owner}
                onClick={() => change({ bucket: card.id, owner: undefined })}
              >
                <span className={styles.dot} data-tone={card.id} aria-hidden="true" />
                <span>
                  <strong>{inGroup.length}</strong>
                  <small>{card.label}</small>
                </span>
              </button>
              {card.id === 'banned' ? (
                <div className={styles.cardHint}>{card.hint}</div>
              ) : (
                <div className={styles.breakdown}>
                  {owners.map(({ value, plural }) => {
                    const count = inGroup.filter(({ account }) => account.owner === value).length
                    if (value === 'Запрет работы' && count === 0) return null
                    return (
                      <button
                        type="button"
                        key={value}
                        title={card.label + ' · ' + plural}
                        data-empty={count === 0}
                        aria-pressed={bucket === card.id && filters.owner === value}
                        onClick={() => change({ bucket: card.id, owner: value })}
                      >
                        {plural}
                        <b>{count}</b>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className={styles.filters}>
        <div className={styles.search}>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3.5 3.5" />
          </svg>
          <input
            type="search"
            aria-label="Поиск"
            placeholder="ID, название аккаунта или партнёр"
            value={filters.query ?? ''}
            onChange={(event) => change({ query: event.target.value })}
          />
        </div>
        <label>
          amoCRM до: с
          <input
            type="date"
            aria-label="amoCRM до — с"
            data-empty={!filters.from}
            value={filters.from ?? ''}
            max={filters.to}
            onChange={(event) => change({ from: event.target.value })}
          />
        </label>
        <label>
          по
          <input
            type="date"
            aria-label="amoCRM до — по"
            data-empty={!filters.to}
            value={filters.to ?? ''}
            min={filters.from}
            onChange={(event) => change({ to: event.target.value })}
          />
        </label>
        <label>
          Тариф
          <select
            value={filters.tariff ?? ''}
            onChange={(event) => change({ tariff: event.target.value })}
          >
            <option value="">все</option>
            {tariffs.map((tariff) => (
              <option key={tariff}>{tariff}</option>
            ))}
          </select>
        </label>
        <label>
          Чей клиент
          <select
            value={filters.owner ?? ''}
            onChange={(event) => change({ owner: event.target.value })}
          >
            <option value="">все</option>
            {owners.map(({ value, label }) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Продлевает
          <select
            value={filters.renewal ?? ''}
            onChange={(event) => change({ renewal: event.target.value })}
          >
            <option value="">все</option>
            {Object.entries(renewalLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label} · {records.filter(({ renewal }) => renewal === value).length}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setPortraitOpen(true)}
          aria-pressed={!!filters.portrait}
        >
          Портрет
        </button>
      </div>
      <div className={styles.results}>
        <button type="button" onClick={reset}>
          Сбросить
        </button>
        {market ? (
          <button
            type="button"
            className={styles.chip}
            aria-label="Сбросить фильтр amoМаркета"
            onClick={() =>
              void navigate({ search: (previous) => ({ ...previous, market: undefined }) })
            }
          >
            amoМаркет · {getMarketWidget(market)?.name ?? market} ·{' '}
            {market.endsWith(':removed') ? 'удалили' : 'стоит сейчас'} ×
          </button>
        ) : null}
        {filters.portrait ? (
          <button
            type="button"
            className={styles.chip}
            aria-label="Убрать фильтр по портрету"
            onClick={() => change({ portrait: undefined })}
          >
            Портрет · {portraitLabel} ×
          </button>
        ) : null}
        <span role="status">
          Найдено {visible.length} из {records.length}
        </span>
      </div>
      <div className={styles.tableWrap}>
        <table>
          <colgroup>
            <col className={styles.accountId} />
            <col className={styles.accountName} />
            <col className={styles.license} />
            <col className={styles.tariff} />
            <col className={styles.seats} />
            <col className={styles.owner} />
            <col className={styles.updated} />
          </colgroup>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={column} scope="col" aria-sort={index === 2 ? 'ascending' : undefined}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.slice(0, limit).map(({ client, account, owner, health, renewal, partner }) => {
              const left = daysLeft(client)
              const trial = client.tariff === 'Пробный период'
              const search = {
                section: 'clients' as const,
                client: client.id,
                market,
                directory: filters,
              }
              return (
                <tr key={client.id}>
                  <td>
                    <span className={styles.dot} data-tone={health} title={healthLabels[health]} />
                    <Link to="/managers" search={search}>
                      {client.id}
                    </Link>
                  </td>
                  <td>
                    <Link to="/managers" search={search}>
                      {client.domain}
                    </Link>
                    <small>
                      {client.name}
                      {client.timezone ? (
                        <span className={styles.timezone}>
                          {client.timezone > 0 ? '+' : '−'}
                          {Math.abs(client.timezone)} МСК
                        </span>
                      ) : null}
                    </small>
                  </td>
                  <td>
                    {dateLabel(client.till)}
                    <small
                      className={styles.licenseNote}
                      data-tone={left < 0 ? 'expired' : left <= 30 ? 'partner' : undefined}
                    >
                      {trial ? 'конец пробного из amoCRM · ' : ''}
                      {left < 0 ? `истекла ${Math.abs(left)} дн. назад` : `осталось ${left} дн.`}
                    </small>
                    {renewal !== 'unknown' ? (
                      <small className={styles.renewal} data-tone={renewal}>
                        продлевает {renewalLabels[renewal]}
                      </small>
                    ) : null}
                  </td>
                  <td>
                    {trial ? <span className={styles.trial}>{client.tariff}</span> : client.tariff}
                  </td>
                  <td>{client.seats}</td>
                  <td>
                    <span className={styles.ownerLabel}>
                      <span className={styles.dot} data-tone={owner?.tone} aria-hidden="true" />
                      {owner?.label ?? account.owner}
                    </span>
                    {owner?.tone === 'partner' ? (
                      <small>{partner || 'партнёр не выбран'}</small>
                    ) : null}
                    {owner?.tone === 'green' && client.excessSeats ? (
                      <small className={styles.overflow}>
                        пользователей больше на {client.excessSeats}
                        {!account.subscribed ? ' · подписка отключена' : null}
                      </small>
                    ) : null}
                  </td>
                  <td>
                    {client.updated || 'не приходили'}
                    {client.age ? <small>{client.age}</small> : null}
                  </td>
                </tr>
              )
            })}
            {!visible.length ? (
              <tr>
                <td colSpan={columns.length} className={styles.empty}>
                  Никого не нашлось по этим фильтрам.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {limit < visible.length ? (
          <div className={styles.pagination}>
            <button type="button" onClick={() => setLimit((current) => current + 50)}>
              Показать ещё {Math.min(50, visible.length - limit)}
            </button>
            <span>
              Показано {limit} из {visible.length}
            </span>
          </div>
        ) : null}
      </div>
      {portraitOpen ? (
        <PortraitDialog
          filter={filters.portrait}
          close={() => setPortraitOpen(false)}
          apply={(portrait) => {
            change({ portrait })
            setPortraitOpen(false)
          }}
        />
      ) : null}
    </section>
  )
}
