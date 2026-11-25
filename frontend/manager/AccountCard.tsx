import { createRequestKey } from '../src/features/operations/intents'
import { CommandFeedback, useAccountCommand } from './accountCommands'
import type { AccountDetail } from './accountsApi'
import { WidgetAccessStatus } from './WidgetAccessStatus'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Timeline } from './Timeline'
import { resolveEpisode } from './episodeResolver'
import { useState, type FormEvent } from 'react'
import { isUnauthorized } from '../src/api/client'
import { StatusBadge } from '../src/components/StatusBadge'
import { lookupState } from '../src/states'
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
import { AccountPortrait } from './AccountPortrait'
import { accountsKey, ReadFailure, useAccountAccessError, type AccountAccess } from './AccountsPage'
import {
  ContactCell,
  DealCell,
  InstallationReviewFeedback,
  ReviewBadge,
  installationsKey,
} from './InstallationsPage'
import { retryInstallationDeal } from './installationsApi'
import { useInstallationReview } from './useInstallationReview'
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
  canReview,
  account,
  canRenew,
  ...actions
}: Omit<Props, 'grants'> &
  AccountActions & {
    account: AccountDetail
    canReview: boolean
    canRenew: boolean
  }) {
  const widgets = useQuery({
    queryKey: [...accountsKey, scope, selected.id, 'widgets', selected.productCursor],
    queryFn: ({ signal }) => listWidgets(selected.id, selected.productCursor, signal),
    retry: false,
  })
  useAccountAccessError(widgets.error, actions.onExpired, actions.onForbidden)
  function page(cursor: string | null) {
    const params = new URLSearchParams(search)
    if (cursor) params.set('widget_cursor', cursor)
    else params.delete('widget_cursor')
    navigate(params.toString())
  }
  function refresh() {
    if (selected.productCursor) page(null)
    actions.onSaved()
  }
  const review = useInstallationReview({
    onAccessError(error) {
      if (isUnauthorized(error)) actions.onExpired()
      else actions.onForbidden()
    },
    refresh,
  })
  const dealRetry = useMutation({
    mutationFn: ({ id, version }: { id: AccountWidget['id']; version: number }) =>
      retryInstallationDeal(id, version),
    onSettled: refresh,
  })
  useAccountAccessError(dealRetry.error, actions.onExpired, actions.onForbidden)
  if (widgets.isError)
    return <ReadFailure error={widgets.error} retry={() => void widgets.refetch()} />
  if (widgets.isPending) return <p role="status">Загружаем виджеты…</p>
  const rows = widgets.data.items
  const reviewLocked = review.state.kind === 'checking' || review.state.kind === 'uncertain'
  return (
    <section className={card.surface} aria-label="Наши виджеты">
      <header className={card.sectionHeader}>
        <h2>Наши виджеты</h2>
        <span className={styles.meta}>
          Platform · снимок на {formatTime(widgets.data.snapshot_at)}
        </span>
      </header>
      <InstallationReviewFeedback review={review} />
      {dealRetry.isError ? (
        <p className={card.empty} role="alert">
          Не удалось подтвердить повтор. Проверьте состояние сделки.
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className={card.empty}>Установок пока нет.</p>
      ) : (
        <div
          className={card.tableScroll}
          role="region"
          aria-label="Установки виджетов"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Enable horizontal keyboard scrolling.
          tabIndex={0}
        >
          <table className={`${styles.table} ${card.widgetsTable}`}>
            <thead>
              <tr>
                <th scope="col">Установка</th>
                <th scope="col">Виджет</th>
                <th scope="col">Категория</th>
                <th scope="col">Статус</th>
                <th scope="col">Доступ до</th>
                <th scope="col">Сделка</th>
                <th scope="col">Контакт из формы активации</th>
                <th scope="col">Отзыв</th>
                <th scope="col" className={card.actionsHeading}>
                  Действия
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Widget
                  key={row.id}
                  row={row}
                  account={account}
                  selected={selected}
                  scope={scope}
                  canRenew={canRenew}
                  onReview={canReview ? review.start : undefined}
                  onDealRetry={canReview ? dealRetry.mutate : undefined}
                  reviewLocked={reviewLocked}
                  retryingDeal={dealRetry.isPending}
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

const reviewDate = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function Widget({
  account,
  row,
  selected,
  scope,
  canRenew,
  onReview,
  onDealRetry,
  reviewLocked,
  retryingDeal,
  actions,
}: {
  account: AccountDetail
  row: AccountWidget
  selected: AccountLocation
  scope: string
  canRenew: boolean
  onReview?: (row: AccountWidget) => void
  onDealRetry?: (target: { id: AccountWidget['id']; version: number }) => void
  reviewLocked: boolean
  retryingDeal: boolean
  actions: AccountActions
}) {
  const [renewing, setRenewing] = useState(false)
  const paid = row.product_line === 'TOP' || row.product_line === 'PRO'
  const covered =
    account.subscription?.state === 'active' &&
    (account.subscription.plan === 'unified' || row.product_line === 'TOP')
  const canRenewRow =
    canRenew && paid && !covered && row.lifecycle === 'current' && row.kind !== 'observed'
  const fromSnapshot = selected.productCursor !== ''
  const product = row.product_id
  const current = useQuery({
    queryKey: [...accountsKey, scope, selected.id, 'widget-current', product],
    queryFn: ({ signal }) =>
      listWidgets(selected.id, '', signal, { kind: 'currentProduct', product }),
    enabled: canRenewRow && fromSnapshot && renewing,
    retry: false,
  })
  useAccountAccessError(current.error, actions.onExpired, actions.onForbidden)
  const latest = current.isError ? undefined : current.data?.items[0]
  const renewalRow = latest ?? row
  const authorizationInfoId = `widget-authorization-${row.id}`
  const reviewStamp = row.review.reviewed_at ? (
    <time dateTime={row.review.reviewed_at}>
      {'✓ проверен ' + reviewDate.format(new Date(row.review.reviewed_at))}
    </time>
  ) : (
    '✓ проверен'
  )
  const deal = row.deal
  return (
    <tr>
      <td>
        <div className={card.rowBadges}>
          {row.lifecycle === 'current' ? (
            <span className={card.currentInstallation}>
              <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="12" className={card.checkBackground} />
                <path
                  d="m7.8 12.1 2.9 3 5.6-6.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {lookupState('installation_lifecycle', row.lifecycle).label}
            </span>
          ) : (
            <StatusBadge domain="installation_lifecycle" state={row.lifecycle} calm />
          )}
          {row.authorization === 'unknown' ? (
            <>
              <button
                type="button"
                className={card.authorizationInfo}
                aria-label="Сведения об авторизации"
                popoverTarget={authorizationInfoId}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.3" />
                  <circle cx="8" cy="5" r=".85" fill="currentColor" />
                  <path
                    d="M8 7.5v3.3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <div id={authorizationInfoId} popover="auto" className={card.authorizationHint}>
                {lookupState('installation_authorization', row.authorization).label}
              </div>
            </>
          ) : (
            <StatusBadge domain="installation_authorization" state={row.authorization} calm />
          )}
        </div>
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
        <div className={card.rowBadges}>
          <strong>{row.product_name || row.product_code}</strong>
        </div>
        <span className={card.cellSecondary}>
          {row.widget_version ? 'Версия ' + row.widget_version : 'Версия не получена'}
        </span>
      </td>
      <td>
        <StatusBadge domain="product_line" state={row.product_line ?? 'uncategorized'} calm />
      </td>
      <td>
        <WidgetAccessStatus access={row.access} />
      </td>
      <td>
        {formatTime(row.access.valid_until)}
        <div className={card.cellSecondary}>
          <StatusBadge domain="product_access_source" state={row.access.source} calm />
        </div>
        <span className={card.cellSecondary}>Расчёт {formatTime(row.access.computed_at)}</span>
      </td>
      <td className={card.widgetDetails}>
        <DealCell
          deal={deal}
          disabled={retryingDeal}
          retry={
            deal && onDealRetry
              ? () => onDealRetry({ id: row.id, version: deal.retry_version })
              : undefined
          }
        />
      </td>
      <td className={card.widgetDetails}>
        <ContactCell contact={row.contact} />
      </td>
      <td>
        <FeedbackSwitch
          account={account}
          row={row}
          actions={actions}
          editable={
            !!onReview &&
            account.capabilities.some((c) => c.action === 'account.profile' && c.allowed)
          }
        />
      </td>
      <td className={card.widgetActions}>
        <div className={card.actionStatus}>
          {row.kind === 'observed' ? (
            <StatusBadge
              domain="installation_event"
              state={row.last_lifecycle_event}
              variant="text"
            />
          ) : row.review.reviewed ? (
            <span className={card.reviewStamp}>{reviewStamp}</span>
          ) : (
            <ReviewBadge row={row} />
          )}
        </div>
        <div className={card.actionStack}>
          {row.kind !== 'observed' && onReview && (
            <button type="button" onClick={() => onReview(row)} disabled={reviewLocked}>
              {row.review.reviewed ? 'Снять отметку' : 'Отметить проверку'}
            </button>
          )}
          {canRenewRow ? (
            <div>
              <button
                type="button"
                className={card.renewButton}
                aria-expanded={renewing}
                onClick={() => setRenewing(!renewing)}
              >
                Продлить
              </button>
              {renewing && (
                <>
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
                      id={selected.id + ':renewal:' + renewalRow.product_id}
                      title="Продление тарифа виджета"
                      version={renewalRow.entitlement_version}
                      initial={{ until: '', reason: '' }}
                      current={
                        <p>Текущий срок тарифа: {formatTime(renewalRow.access.own_until)}.</p>
                      }
                      submitLabel="Продлить доступ"
                      command={(fields, _, version, key) => ({
                        kind: 'renewal',
                        account: selected.id,
                        product: renewalRow.product_id,
                        version,
                        key,
                        body: JSON.stringify({
                          product_id: renewalRow.product_id,
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
                </>
              )}
            </div>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

function FeedbackSwitch({
  account,
  row,
  actions,
  editable,
}: {
  account: AccountDetail
  row: AccountWidget
  actions: AccountActions
  editable: boolean
}) {
  const cmd = useAccountCommand(account.account_id + ':feedback:' + row.product_id, actions)
  const checked = account.feedbackProducts?.includes(row.product_id) ?? false
  const conflict = cmd.entry.state.kind === 'conflict'
  return (
    <>
      <input
        className={card.feedbackSwitch}
        type="checkbox"
        role="switch"
        checked={checked}
        aria-checked={checked}
        aria-label={'Отзыв о виджете ' + row.product_name}
        disabled={!editable || !account.feedbackProducts || cmd.locked || conflict}
        onChange={() =>
          cmd.start({
            kind: 'profile',
            account: account.account_id,
            version: account.version,
            key: createRequestKey(),
            body: JSON.stringify({
              widget_feedback: { product_id: row.product_id, left: !checked },
              reason: checked ? 'Снята отметка об отзыве' : 'Клиент оставил отзыв о виджете',
            }),
          })
        }
      />
      {conflict && (
        <button type="button" onClick={cmd.discardDraft}>
          Проверить обновлённую отметку
        </button>
      )}
      {cmd.entry.state.kind !== 'saved' && <CommandFeedback command={cmd} />}
    </>
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
      <dt>Категория</dt>
      <dd>
        <StatusBadge domain="product_line" state={row.product_line ?? 'uncategorized'} calm />
      </dd>
      <dt>Статус</dt>
      <dd>
        <WidgetAccessStatus access={row.access} />
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
              <div
                className={card.tableScroll}
                role="region"
                aria-label="Таблица пользователей"
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Enable horizontal keyboard scrolling.
                tabIndex={0}
              >
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
            canRenew={grants.includes('clients.renew')}
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
          <nav className={styles.tabs + ' ' + card.tabs} aria-label="Вкладки клиента">
            {tabLinks.map(([tab, label]) => (
              <ManagerLink
                key={tab}
                search={accountSearch(search, account.account_id, tab)}
                navigate={navigate}
                current={selected.tab === tab}
              >
                {label}
                {tab === 'widgets' ? (
                  <span
                    className={card.tabCount}
                    title="Число активных продуктов"
                    aria-hidden="true"
                  >
                    {account.active_products_count}
                  </span>
                ) : null}
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
              account={account}
              selected={selected}
              scope={scope}
              search={search}
              navigate={navigate}
              canReview={canWrite}
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
