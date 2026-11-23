import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { isApiError } from '../src/api/client'
import { EmptyState } from '../src/components/EmptyState'
import { StatusBadge } from '../src/components/StatusBadge'
import { EMPTY, formatExpiry, formatRelativeTime, formatTime } from '../src/lib/format'
import { lookupState } from '../src/states'
import {
  listAccounts,
  widgetCategories,
  type AccountOverviewCounts,
  type AccountSummary,
} from './accountsApi'
import {
  accountSearch,
  getAccountSearch,
  ManagerLink,
  resetAccountSearch,
  updateAccountSearch,
} from './accountsLocation'
import { moscowOffset } from './accountTimeZone'
import { ClientPortraitFilter } from './ClientPortraitFilter'
import sharedStyles from './Accounts.module.css'
import styles from './ClientsDirectory.module.css'

export const accountsKey = ['managers', 'accounts']

export type AccountAccess = {
  scope: string
  onExpired: () => void
  onForbidden: () => void
}

export function useAccountAccessError(
  error: unknown,
  onExpired: () => void,
  onForbidden: () => void,
) {
  useEffect(() => {
    if (!isApiError(error)) return
    if (error.status === 401) onExpired()
    if (error.status === 403) onForbidden()
  }, [error, onExpired, onForbidden])
}

export function ReadFailure({ error, retry }: { error: unknown; retry: () => void }) {
  const status = isApiError(error) ? error.status : 0
  return (
    <div className={sharedStyles.actions} role="alert">
      <span>
        {status === 403
          ? 'Нет доступа'
          : status === 404
            ? 'Запись не найдена'
            : status === 400
              ? 'Проверьте параметры запроса'
              : 'Источник недоступен'}
      </span>
      {status !== 403 && status !== 404 ? (
        <button type="button" onClick={retry}>
          Повторить
        </button>
      ) : null}
    </div>
  )
}

const classifications = [
  { value: 'Наш клиент', title: 'Наши клиенты' },
  { value: 'Без партнёра', title: 'Свободные' },
  { value: 'Клиент партнёра', title: 'Клиенты партнёров' },
  { value: 'Запрет работы', title: 'Запрет работы' },
] as const

const renewalOptions = [
  { value: 'direct', title: 'Напрямую' },
  { value: 'partner', title: 'Через партнёра' },
] as const

const groups = [
  { key: 'all', title: 'все аккаунты' },
  { key: 'receiving', title: 'получаем данные' },
  { key: 'no_data', title: 'нет данных' },
  { key: 'inactive', title: 'не пользуются amoCRM' },
  { key: 'blocked', title: 'запрет работы' },
  { key: 'trial', title: 'пробный период amoCRM' },
] as const

const missingLicense = 'Источник срока лицензии amoCRM не подключён'
const licenseDate = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function ClientGroups({
  overview,
  group,
  classification,
  select,
}: {
  overview?: AccountOverviewCounts
  group: string
  classification: string
  select: (group: string | null, classification: string | null) => void
}) {
  return (
    <div className={styles.groups} role="group" aria-label="Сводка по аккаунтам">
      {groups.map(({ key, title }) => {
        const licensedGroup = key === 'inactive' || key === 'trial'
        const counts = licensedGroup ? undefined : overview?.[key]
        const filter = key === 'all' ? null : key
        const active = group === key
        return (
          <div
            className={styles.group}
            data-selected={active && (key !== 'all' || classification !== '')}
            key={key}
          >
            <button
              type="button"
              className={styles.groupButton}
              aria-pressed={active && classification === ''}
              disabled={!counts}
              title={licensedGroup ? missingLicense : undefined}
              onClick={() => select(active && !classification ? null : filter, null)}
            >
              <span className={styles.groupDot} data-group={key} aria-hidden="true" />
              <span>
                <strong>{counts?.total ?? EMPTY}</strong>
                <small>{title}</small>
              </span>
            </button>
            {key === 'blocked' || licensedGroup ? (
              <p className={styles.groupNote}>
                {key === 'blocked'
                  ? 'Аккаунты с отметкой «Запрет работы»'
                  : 'Нет данных о лицензии'}
              </p>
            ) : (
              <div className={styles.breakdown}>
                {classifications.map(({ value, title: label }) => {
                  const pressed = active && classification === value
                  const count = counts ? (counts.by_classification[value] ?? 0) : undefined
                  if (key !== 'all' && value === 'Запрет работы' && count === 0) return null
                  return (
                    <button
                      type="button"
                      key={value}
                      title={title + ' · ' + label}
                      aria-label={
                        title + ' · ' + label + (count === undefined ? '' : ' · ' + count)
                      }
                      aria-pressed={pressed}
                      disabled={!counts}
                      data-zero={count === 0}
                      onClick={() => select(pressed ? null : filter, pressed ? null : value)}
                    >
                      {label}
                      <b>{count ?? EMPTY}</b>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ClientTable({
  items,
  snapshot,
  search,
  navigate,
}: {
  items: AccountSummary[]
  snapshot: string
  search: string
  navigate: (search: string) => void
}) {
  const time = new Date(snapshot)
  return (
    <div
      className={styles.tableScroll}
      role="region"
      aria-label="Таблица клиентов"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Enable horizontal keyboard scrolling.
      tabIndex={0}
    >
      <table className={styles.table}>
        <colgroup>
          <col className={styles.idColumn} />
          <col className={styles.nameColumn} />
          <col className={styles.licenseColumn} />
          <col className={styles.tariffColumn} />
          <col className={styles.usersColumn} />
          <col className={styles.ownerColumn} />
          <col className={styles.updatedColumn} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">ID amoCRM</th>
            <th scope="col">Название</th>
            <th scope="col" title={missingLicense}>
              amoCRM до
            </th>
            <th scope="col">Категории виджетов</th>
            <th scope="col">Активные пользователи</th>
            <th scope="col">Чей клиент</th>
            <th scope="col">Данные обновлены</th>
          </tr>
        </thead>
        <tbody>
          {items.map((account) => {
            const link = accountSearch(search, account.account_id)
            const subdomain = account.current_domain?.split('.')[0]
            const name = account.display_name
            const zone = moscowOffset(account.time_zone, snapshot)
            const secondaryName =
              subdomain && name !== subdomain && name !== account.current_domain ? name : null
            const expiry = account.license.value?.license_until
            const refreshed = account.active_users.observed_at
            return (
              <tr key={account.account_id}>
                <td>
                  <div className={styles.identity}>
                    <StatusBadge
                      domain="client_data"
                      state={account.data_group ?? 'unknown'}
                      variant="dot"
                    />
                    <ManagerLink search={link} navigate={navigate}>
                      {account.amo_account_id}
                    </ManagerLink>
                  </div>
                </td>
                <td>
                  {subdomain || name ? (
                    <ManagerLink
                      search={link}
                      navigate={navigate}
                      label={secondaryName ? subdomain + ' · ' + secondaryName : undefined}
                    >
                      {subdomain ?? name}
                    </ManagerLink>
                  ) : (
                    EMPTY
                  )}
                  {secondaryName ? (
                    <small>
                      {secondaryName}
                      {zone ? (
                        <span className={styles.zone} title={account.time_zone ?? undefined}>
                          {zone}
                        </span>
                      ) : null}
                    </small>
                  ) : zone ? (
                    <span className={styles.zone} title={account.time_zone ?? undefined}>
                      {zone}
                    </span>
                  ) : null}
                </td>
                <td>
                  {expiry ? (
                    <>
                      <time dateTime={expiry}>{licenseDate.format(new Date(expiry))}</time>
                      <small
                        className={
                          Date.parse(expiry) <= time.getTime() ? styles.expired : undefined
                        }
                      >
                        {formatExpiry(expiry, time)}
                      </small>
                    </>
                  ) : (
                    <span title={missingLicense}>{EMPTY}</span>
                  )}
                  {account.license.state === 'stale' ? (
                    <StatusBadge domain="freshness" state={account.license.state} calm />
                  ) : null}
                  {account.renewal_channel ? (
                    <div className={styles.renewal} data-channel={account.renewal_channel}>
                      <StatusBadge
                        domain="client_renewal"
                        state={account.renewal_channel}
                        variant="text"
                      />
                    </div>
                  ) : null}
                </td>
                <td>
                  {account.widgetCategories?.length ? (
                    <div className={styles.tariffs}>
                      {account.widgetCategories.map((category) => (
                        <StatusBadge domain="product_line" state={category} key={category} />
                      ))}
                    </div>
                  ) : (
                    EMPTY
                  )}
                </td>
                <td>
                  {account.active_users.value ?? EMPTY}
                  {account.active_users.state !== 'fresh' ? (
                    <div>
                      <StatusBadge domain="freshness" state={account.active_users.state} calm />
                    </div>
                  ) : null}
                </td>
                <td>
                  <div className={styles.owner} data-classification={account.classification}>
                    <StatusBadge
                      domain="client_classification"
                      state={account.classification ?? 'unknown'}
                      variant="text"
                    />
                  </div>
                  {account.partner_name ? <small>{account.partner_name}</small> : null}
                </td>
                <td>
                  {refreshed ? (
                    <>
                      <time
                        dateTime={refreshed}
                        title="Активные пользователи · последнее наблюдение"
                      >
                        {formatTime(refreshed)}
                      </time>
                      <small>{formatRelativeTime(refreshed, time)}</small>
                    </>
                  ) : (
                    <small>Нет наблюдений</small>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function AccountsPage({
  search,
  navigate,
  scope,
  onExpired,
  onForbidden,
}: AccountAccess & {
  search: string
  navigate: (search: string) => void
}) {
  const { query: params, filter, invalid } = getAccountSearch(search)
  const [portraitOpen, setPortraitOpen] = useState(false)
  const queryString = params.toString()
  const page = useQuery({
    queryKey: [...accountsKey, scope, queryString, filter],
    queryFn: ({ signal }) => listAccounts(queryString, filter, signal),
    enabled: !invalid,
    placeholderData: keepPreviousData,
    retry: false,
  })
  useAccountAccessError(page.error, onExpired, onForbidden)
  const invalidCursor =
    Boolean(params.get('cursor')) && isApiError(page.error) && page.error.status === 400
  const classificationsSelected = params.getAll('classification')
  const classification =
    classificationsSelected.length > 1 ? 'multiple' : (classificationsSelected[0] ?? '')
  const group = params.get('data_group') ?? 'all'
  const query = params.get('q') ?? ''
  const [searchDraft, setSearchDraft] = useState({ query, value: query })
  if (searchDraft.query !== query) setSearchDraft({ query, value: query })
  const trimmedQuery = searchDraft.value.trim()
  useEffect(() => {
    if (trimmedQuery === query) return
    const timer = window.setTimeout(() => {
      navigate(updateAccountSearch(search, { q: trimmedQuery, cursor: null }))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [navigate, query, search, trimmedQuery])
  const limit = params.get('limit') ?? '25'
  const ready = page.isSuccess && !page.isPlaceholderData && !invalid ? page.data : undefined
  const overview = page.data?.overview
  const resetSearch = resetAccountSearch(search)
  const activeFilters = resetSearch !== new URLSearchParams(search).toString()

  function change(updated: Parameters<typeof updateAccountSearch>[1]) {
    navigate(updateAccountSearch(search, { q: trimmedQuery, ...updated, cursor: null }))
  }

  function searchClients(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    change({})
  }

  return (
    <section className={styles.page}>
      <header className={styles.heading}>
        <h1>Клиенты</h1>
        <p>
          Аккаунты amoCRM, где стоят или стояли наши виджеты. Нажмите на название или ID, чтобы
          открыть карточку.
        </p>
      </header>
      <ClientGroups
        overview={overview}
        group={group}
        classification={classification}
        select={(data_group, owner) => change({ data_group, classification: owner })}
      />
      <div className={styles.filters}>
        <form className={styles.search} onSubmit={searchClients}>
          <input
            name="q"
            type="search"
            aria-label="Поиск"
            maxLength={200}
            value={searchDraft.value}
            onChange={(event) => setSearchDraft({ query, value: event.target.value })}
            placeholder="ID, название аккаунта или партнёр"
          />
          <button type="submit" aria-label="Найти клиентов" title="Найти клиентов">
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
          </button>
        </form>
        <div className={styles.dates} title={missingLicense}>
          <label>
            amoCRM до: с
            <input aria-label="Срок amoCRM с" type="date" disabled />
          </label>
          <label>
            по
            <input aria-label="Срок amoCRM по" type="date" disabled />
          </label>
        </div>
        <label>
          Категории виджетов
          <select
            aria-label="Категории виджетов"
            value={params.get('tariff') ?? ''}
            onChange={(event) => change({ tariff: event.target.value })}
            disabled={!overview}
          >
            <option value="">все</option>
            {params.get('tariff') === 'trial' ? <option value="trial">Без категории</option> : null}
            {widgetCategories.map((tariff) => (
              <option key={tariff} value={tariff}>
                {lookupState('product_line', tariff).label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Чей клиент
          <select
            aria-label="Чей клиент"
            value={classification}
            onChange={(event) => change({ classification: event.target.value })}
          >
            <option value="">все</option>
            {classification === 'multiple' ? (
              <option value="multiple" disabled>
                Несколько категорий
              </option>
            ) : null}
            {classifications.map(({ value }) => (
              <option key={value} value={value}>
                {lookupState('client_classification', value).label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Продлевает
          <select
            aria-label="Продлевает"
            value={params.get('renewal_channel') ?? ''}
            onChange={(event) => change({ renewal_channel: event.target.value })}
            disabled={!overview}
          >
            <option value="">все</option>
            {renewalOptions.map(({ value, title }) => (
              <option key={value} value={value}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-pressed={!!filter}
          onClick={() => setPortraitOpen(true)}
        >
          Портрет
        </button>
        {activeFilters ? (
          <button
            type="button"
            className={styles.reset}
            onClick={() => {
              setSearchDraft({ query, value: '' })
              navigate(resetSearch)
            }}
          >
            Сбросить
          </button>
        ) : null}
        {ready ? (
          <p className={styles.found} role="status">
            Найдено {ready.total}
            {ready.overview ? ' из ' + ready.overview.all.total : ''}
          </p>
        ) : null}
      </div>
      {invalid ? (
        <div className={sharedStyles.actions} role="alert">
          Некорректный фильтр портрета.
          <button type="button" onClick={() => change({ portrait: null })}>
            Сбросить фильтр
          </button>
        </div>
      ) : page.isError ? (
        invalidCursor ? (
          <div className={sharedStyles.actions} role="alert">
            Курсор недействителен.
            <button type="button" onClick={() => change({})}>
              Первая страница
            </button>
          </div>
        ) : (
          <ReadFailure error={page.error} retry={() => void page.refetch()} />
        )
      ) : ready ? (
        <div className={styles.results}>
          {ready.items.length ? (
            <ClientTable
              items={ready.items}
              snapshot={ready.snapshot_at}
              search={search}
              navigate={navigate}
            />
          ) : (
            <EmptyState
              title="Клиенты не найдены"
              description={activeFilters ? 'Измените или сбросьте фильтры.' : undefined}
            />
          )}
          <div className={styles.pager}>
            <span className={styles.meta}>
              Platform · снимок на {formatTime(ready.snapshot_at)}
            </span>
            <label>
              На странице
              <select value={limit} onChange={(event) => change({ limit: event.target.value })}>
                {(['25', '50', '100'].includes(limit)
                  ? ['25', '50', '100']
                  : [limit, '25', '50', '100']
                ).map((size) => (
                  <option value={size} key={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            {params.has('cursor') ? (
              <button type="button" onClick={() => change({})}>
                Первая страница
              </button>
            ) : null}
            {ready.next_cursor ? (
              <button
                type="button"
                onClick={() => navigate(updateAccountSearch(search, { cursor: ready.next_cursor }))}
              >
                Следующая страница
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className={styles.meta} role="status">
          Загружаем клиентов…
        </p>
      )}
      {portraitOpen ? (
        <ClientPortraitFilter
          scope={scope}
          onExpired={onExpired}
          onForbidden={onForbidden}
          filter={filter}
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
