import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Timeline } from './Timeline'
import { resolveEpisode } from './episodeResolver'
import { useState, type FormEvent } from 'react'
import { StatusBadge } from '../src/components/StatusBadge'
import { formatTime } from '../src/lib/format'
import { getAccount, listUsers, listWidgets, type AccountWidget } from './accountsApi'
import {
  accountSearch,
  accountTabs,
  listSearch,
  ManagerLink,
  type getAccountLocation,
  type AccountTab,
} from './accountsLocation'
import { AccountForm } from './AccountForms'
import {
  AccountEvidence,
  AccountOverview,
  accountTitle,
  type AccountActions,
} from './AccountOverview'
import { AccountAudit, AccountPortrait } from './AccountPortrait'
import { accountsKey, ReadFailure, useAccountAccessError, type AccountAccess } from './AccountsPage'
import { installationsKey } from './InstallationsPage'
import { workspaceSection } from './Workspace'
import styles from './Accounts.module.css'
import card from './AccountCard.module.css'

const accountListLabels: Partial<Record<ReturnType<typeof workspaceSection>, string>> = {
  clients: 'Клиенты',
  feed: 'Лента событий',
}

type AccountLocation = NonNullable<ReturnType<typeof getAccountLocation>>
type Props = AccountAccess & {
  selected: AccountLocation
  search: string
  navigate: (search: string) => void
  grants: string[]
}

function Widgets({
  selected,
  search,
  navigate,
  scope,
  canRenew,
  ...actions
}: Omit<Props, 'grants'> &
  AccountActions & {
    canRenew: boolean
  }) {
  const widgets = useQuery({
    queryKey: [...accountsKey, scope, selected.id, 'widgets', selected.productCursor],
    queryFn: ({ signal }) => listWidgets(selected.id, selected.productCursor, signal),
    retry: false,
  })
  useAccountAccessError(widgets.error, actions.onExpired, actions.onForbidden)
  if (widgets.isError)
    return <ReadFailure error={widgets.error} retry={() => void widgets.refetch()} />
  if (widgets.isPending) return <p role="status">Загружаем виджеты…</p>
  const rows = widgets.data.items
  function page(cursor: string | null) {
    const params = new URLSearchParams(search)
    if (cursor) params.set('widget_cursor', cursor)
    else params.delete('widget_cursor')
    navigate(params.toString())
  }
  return (
    <section className={card.surface} aria-label="Наши виджеты">
      <header className={card.sectionHeader}>
        <h2>Наши виджеты</h2>
        <span className={styles.meta}>
          Platform · снимок на {formatTime(widgets.data.snapshot_at)}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className={card.empty}>Установок пока нет.</p>
      ) : (
        <div className={card.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Статус · дата</th>
                <th scope="col">Виджет</th>
                <th scope="col">Доступ до</th>
                <th scope="col">Авторизация</th>
                {canRenew ? <th scope="col">Действия</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Widget
                  key={row.id}
                  row={row}
                  selected={selected}
                  scope={scope}
                  canRenew={canRenew}
                  actions={actions}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected.productCursor || widgets.data.next_cursor ? (
        <div className={card.pager}>
          {selected.productCursor ? (
            <button type="button" onClick={() => page(null)}>
              Первая страница
            </button>
          ) : null}
          {widgets.data.next_cursor ? (
            <button type="button" onClick={() => page(widgets.data.next_cursor)}>
              Следующая страница
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function Widget({
  row: snapshotRow,
  selected,
  scope,
  canRenew,
  actions,
}: {
  row: AccountWidget
  selected: AccountLocation
  scope: string
  canRenew: boolean
  actions: AccountActions
}) {
  const [renewing, setRenewing] = useState(false)
  const canRenewRow = canRenew && snapshotRow.lifecycle === 'current'
  const fromSnapshot = selected.productCursor !== ''
  const product = snapshotRow.product_id
  const current = useQuery({
    queryKey: [...accountsKey, scope, selected.id, 'widget-current', product],
    queryFn: ({ signal }) =>
      listWidgets(selected.id, '', signal, { kind: 'currentProduct', product }),
    enabled: canRenewRow && fromSnapshot && renewing,
    retry: false,
  })
  useAccountAccessError(current.error, actions.onExpired, actions.onForbidden)
  const latest = current.isError ? undefined : current.data?.items[0]
  const row = latest ?? snapshotRow
  return (
    <tr>
      <td>
        <StatusBadge domain="installation_lifecycle" state={row.lifecycle} calm />
        <time className={card.cellSecondary} dateTime={row.installed_at}>
          {formatTime(row.installed_at)}
        </time>
        {row.removed_at ? (
          <time className={card.cellSecondary} dateTime={row.removed_at}>
            Удалён {formatTime(row.removed_at)}
          </time>
        ) : null}
      </td>
      <td>
        <strong>{row.product_name || row.product_code}</strong>
        <span className={card.cellSecondary}>
          {row.product_code}
          {row.kind === 'observed' ? ' · Наблюдение Core' : ' · Эпизод ' + row.generation}
        </span>
      </td>
      <td>
        {formatTime(row.access.valid_until)}
        <div className={card.cellSecondary}>
          <StatusBadge domain="product_access_source" state={row.access.source} calm />
        </div>
        <span className={card.cellSecondary}>Расчёт {formatTime(row.access.computed_at)}</span>
      </td>
      <td>
        <StatusBadge domain="installation_authorization" state={row.authorization} calm />
        <div className={card.cellSecondary}>
          <StatusBadge
            domain="product_access"
            state={row.access.active ? 'active' : 'inactive'}
            calm
          />
        </div>
      </td>
      {canRenew ? (
        <td className={card.widgetActions}>
          {canRenewRow ? (
            <details
              onToggle={(event) => {
                if (event.currentTarget.open) setRenewing(true)
              }}
            >
              <summary>Продлить</summary>
              {fromSnapshot && renewing ? (
                current.isError ? (
                  <ReadFailure error={current.error} retry={() => void current.refetch()} />
                ) : current.isPending ? (
                  <p role="status">Проверяем текущий срок…</p>
                ) : !latest ? (
                  <p role="alert">Текущая установка не найдена.</p>
                ) : null
              ) : null}
              {!fromSnapshot || latest ? (
                <AccountForm
                  {...actions}
                  id={selected.id + ':renewal:' + row.product_id}
                  title="Ручное продление"
                  version={row.entitlement_version}
                  initial={{ until: '', reason: '' }}
                  current={
                    <p>
                      Текущий срок:{' '}
                      {row.access.valid_until ? formatTime(row.access.valid_until) : '—'}.
                    </p>
                  }
                  submitLabel="Продлить доступ"
                  command={(fields, _, version, key) => ({
                    kind: 'renewal',
                    account: selected.id,
                    product: row.product_id,
                    version,
                    key,
                    body: JSON.stringify({
                      product_id: row.product_id,
                      target_until: new Date(fields.until).toISOString(),
                      reason: fields.reason.trim(),
                    }),
                  })}
                >
                  {(fields, edit) => (
                    <>
                      <label>
                        Продлить до
                        <input
                          type="datetime-local"
                          required
                          value={fields.until}
                          onChange={(event) => edit('until', event.target.value)}
                        />
                      </label>
                      <label>
                        Причина продления
                        <input
                          required
                          maxLength={1000}
                          value={fields.reason}
                          onChange={(event) => edit('reason', event.target.value)}
                        />
                      </label>
                    </>
                  )}
                </AccountForm>
              ) : null}
            </details>
          ) : null}
        </td>
      ) : null}
    </tr>
  )
}

function WidgetFacts({ row }: { row: AccountWidget }) {
  return (
    <dl className={styles.facts}>
      <dt>Поколение установки</dt>
      <dd>{row.generation}</dd>
      <dt>{row.kind === 'observed' ? 'Зарегистрирован в Core' : 'Установлен'}</dt>
      <dd>{formatTime(row.installed_at)}</dd>
      <dt>Удалён</dt>
      <dd>{row.removed_at ? formatTime(row.removed_at) : '—'}</dd>
      <dt>Установка</dt>
      <dd>
        <StatusBadge domain="installation_lifecycle" state={row.lifecycle} calm />
      </dd>
      <dt>Авторизация</dt>
      <dd>
        <StatusBadge domain="installation_authorization" state={row.authorization} calm />
      </dd>
      <dt>Доступ</dt>
      <dd>
        <StatusBadge
          domain="product_access"
          state={row.access.active ? 'active' : 'inactive'}
          calm
        />
      </dd>
      <dt>Источник срока</dt>
      <dd>
        <StatusBadge domain="product_access_source" state={row.access.source} calm />
      </dd>
      <dt>Доступ до</dt>
      <dd>{row.access.valid_until ? formatTime(row.access.valid_until) : '—'}</dd>
      <dt>Собственный срок</dt>
      <dd>{row.access.own_until ? formatTime(row.access.own_until) : '—'}</dd>
      <dt>Доступ рассчитан</dt>
      <dd>{formatTime(row.access.computed_at)}</dd>
      <dt>Версия срока</dt>
      <dd>{row.entitlement_version}</dd>
    </dl>
  )
}
function HistoricalWidget({
  selected,
  scope,
  onExpired,
  onForbidden,
}: Pick<Props, 'selected' | 'scope' | 'onExpired' | 'onForbidden'>) {
  const episode = selected.episode ?? ''
  const result = useQuery({
    queryKey: [...accountsKey, scope, selected.id, 'episode', episode],
    queryFn: ({ signal }) => resolveEpisode(selected.id, episode, signal),
    retry: false,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })
  useAccountAccessError(result.error, onExpired, onForbidden)
  if (result.isError)
    return (
      <>
        <ReadFailure error={result.error} retry={() => void result.refetch()} />
        <p role="alert">
          {result.error instanceof Error && !('status' in result.error) ? result.error.message : ''}
        </p>
      </>
    )
  if (result.isPending) return <p role="status">Ищем точную установку…</p>
  if (!result.data) return <p>Установка с указанным ID не найдена в снимке.</p>
  return (
    <section className={styles.panel}>
      <h3>{result.data.product_name || result.data.product_code}</h3>
      <p>ID установки {result.data.id}</p>
      <WidgetFacts row={result.data} />
    </section>
  )
}

const userFilters = {
  all: 'Все',
  active: 'Активные',
  inactive: 'Деактивированные',
  admins: 'Администраторы',
} as const
type UserFilter = keyof typeof userFilters
type CrmUser = NonNullable<Awaited<ReturnType<typeof listUsers>>['value']>[number]

function matchesUser(user: CrmUser, filter: UserFilter) {
  if (filter === 'active') return user.is_active
  if (filter === 'inactive') return !user.is_active
  if (filter === 'admins') return user.is_admin
  return true
}

function Users({
  selected,
  scope,
  search,
  navigate,
  onExpired,
  onForbidden,
}: Pick<Props, 'selected' | 'scope' | 'search' | 'navigate' | 'onExpired' | 'onForbidden'>) {
  const users = useQuery({
    queryKey: [...accountsKey, scope, selected.id, 'crm-users'],
    queryFn: ({ signal }) => listUsers(selected.id, signal),
    retry: false,
  })
  useAccountAccessError(users.error, onExpired, onForbidden)
  if (users.isError) return <ReadFailure error={users.error} retry={() => void users.refetch()} />
  if (users.isPending) return <p role="status">Загружаем пользователей…</p>
  const params = new URLSearchParams(search)
  const filterValue = params.get('users_filter')
  const filter =
    filterValue && Object.hasOwn(userFilters, filterValue) ? (filterValue as UserFilter) : 'all'
  const searchValue = params.get('users_q') ?? ''
  const term = searchValue.trim().toLocaleLowerCase('ru-RU')
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = String(new FormData(event.currentTarget).get('query') ?? '').trim()
    if (value) params.set('users_q', value)
    else params.delete('users_q')
    navigate(params.toString())
  }
  return (
    <AccountEvidence title="Пользователи amoCRM" value={users.data}>
      {(items) => {
        const counts = { all: items.length, active: 0, inactive: 0, admins: 0 }
        for (const user of items) {
          counts[user.is_active ? 'active' : 'inactive']++
          if (user.is_admin) counts.admins++
        }
        const rows = items.filter(
          (user) =>
            matchesUser(user, filter) &&
            (user.name.toLocaleLowerCase('ru-RU').includes(term) || user.id.includes(term)),
        )
        return (
          <>
            <div className={card.userToolbar}>
              <nav className={card.userFilters} aria-label="Статус пользователей">
                {(Object.keys(userFilters) as UserFilter[]).map((key) => {
                  const next = new URLSearchParams(search)
                  if (key === 'all') next.delete('users_filter')
                  else next.set('users_filter', key)
                  return (
                    <ManagerLink
                      key={key}
                      current={filter === key}
                      search={next.toString()}
                      navigate={navigate}
                    >
                      {userFilters[key]} · {counts[key]}
                    </ManagerLink>
                  )
                })}
              </nav>
              <form key={searchValue} onSubmit={apply} className={card.userSearch}>
                <input
                  type="search"
                  name="query"
                  aria-label="Имя или ID пользователя"
                  placeholder="Имя или ID"
                  defaultValue={searchValue}
                  maxLength={256}
                />
                <button type="submit">Найти</button>
              </form>
            </div>
            {rows.length === 0 ? (
              <p className={card.empty}>
                {items.length ? 'Пользователи по фильтру не найдены.' : 'Пользователей нет.'}
              </p>
            ) : (
              <div className={card.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Имя</th>
                      <th scope="col">ID</th>
                      <th scope="col">Права</th>
                      <th scope="col">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((user) => (
                      <tr key={user.id} className={user.is_active ? undefined : card.inactiveUser}>
                        <td>{user.name}</td>
                        <td>{user.id}</td>
                        <td>{user.is_admin ? 'Администратор' : 'Пользователь'}</td>
                        <td>
                          <StatusBadge
                            domain="crm_user"
                            state={user.is_active ? 'active' : 'inactive'}
                            calm
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      }}
    </AccountEvidence>
  )
}

export function ManagerAccountCard({
  selected,
  search,
  navigate,
  grants,
  scope,
  onExpired,
  onForbidden,
}: Props) {
  const cache = useQueryClient()
  const detail = useQuery({
    queryKey: [...accountsKey, scope, selected.id, 'detail'],
    queryFn: ({ signal }) => getAccount(selected.id, signal),
    retry: false,
  })
  useAccountAccessError(detail.error, onExpired, onForbidden)
  const actions = {
    onExpired,
    onForbidden,
    onSaved: () => {
      void cache.invalidateQueries({ queryKey: [...accountsKey, scope] })
      void cache.invalidateQueries({ queryKey: [...installationsKey, scope] })
      void cache.invalidateQueries({ queryKey: ['managers', 'timeline', scope] })
    },
  }
  const tabLinks = Object.entries(accountTabs) as [AccountTab, string][]
  const account = detail.isError ? undefined : detail.data
  const canWrite = grants.includes('clients.write')
  const canWritePortrait =
    canWrite &&
    (account?.capabilities.some(
      (capability) => capability.action === 'account.portrait' && capability.allowed,
    ) ??
      false)
  const parent = workspaceSection(search)
  return (
    <article className={styles.workspace}>
      <nav aria-label="Путь к карточке аккаунта" className={card.breadcrumb}>
        <ManagerLink search={listSearch(search)} navigate={navigate}>
          {accountListLabels[parent] ?? 'Установки'}
        </ManagerLink>
        {account ? (
          <>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{accountTitle(account)}</span>
          </>
        ) : null}
      </nav>
      {detail.isError ? (
        <ReadFailure error={detail.error} retry={() => void detail.refetch()} />
      ) : detail.isPending || !account ? (
        <p role="status">Загружаем карточку…</p>
      ) : (
        <>
          <AccountOverview
            account={account}
            canWrite={canWrite}
            usersLink={(label) => (
              <ManagerLink
                search={accountSearch(search, account.account_id, 'users')}
                navigate={navigate}
                label={'Пользователи amoCRM, активных ' + label}
              >
                {label}
              </ManagerLink>
            )}
            {...actions}
          />
          <nav className={styles.tabs} aria-label="Вкладки клиента">
            {tabLinks.map(([tab, label]) => (
              <ManagerLink
                key={tab}
                search={accountSearch(search, account.account_id, tab)}
                navigate={navigate}
                current={selected.tab === tab}
              >
                {label}
              </ManagerLink>
            ))}
          </nav>
          {selected.tab === 'widgets' && selected.episode ? (
            <HistoricalWidget
              selected={selected}
              scope={scope}
              onExpired={onExpired}
              onForbidden={onForbidden}
            />
          ) : selected.tab === 'widgets' ? (
            <Widgets
              selected={selected}
              scope={scope}
              search={search}
              navigate={navigate}
              canRenew={
                grants.includes('clients.renew') &&
                account.capabilities.some(
                  (capability) => capability.action === 'account.renewal' && capability.allowed,
                )
              }
              {...actions}
            />
          ) : null}
          {selected.tab === 'portrait' ? (
            <AccountPortrait
              account={selected.id}
              scope={scope}
              canWrite={canWritePortrait}
              canConfigure={grants.includes('configuration.manage')}
              {...actions}
            />
          ) : null}
          {selected.tab === 'audit' ? (
            <AccountAudit
              account={selected.id}
              scope={scope}
              canWrite={
                canWrite &&
                account.capabilities.some(
                  (capability) =>
                    capability.action === 'account.portrait_audit_date' && capability.allowed,
                )
              }
              {...actions}
            />
          ) : null}
          {selected.tab === 'history' ? (
            <Timeline
              context={{ kind: 'history', account: selected.id }}
              search={search}
              navigate={navigate}
              grants={grants}
              scope={scope}
              onExpired={onExpired}
              onForbidden={onForbidden}
            />
          ) : null}
          {selected.tab === 'users' ? (
            <Users
              selected={selected}
              search={search}
              navigate={navigate}
              scope={scope}
              onExpired={onExpired}
              onForbidden={onForbidden}
            />
          ) : null}
        </>
      )}
    </article>
  )
}
