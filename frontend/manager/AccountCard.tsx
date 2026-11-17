import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import { AccountEvidence, AccountOverview, type AccountActions } from './AccountOverview'
import { AccountPortrait } from './AccountPortrait'
import { accountsKey, ReadFailure, useAccountAccessError, type AccountAccess } from './AccountsPage'
import { installationsKey } from './InstallationsPage'
import styles from './Accounts.module.css'

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
    <div className={styles.workspace}>
      <p className={styles.meta}>Platform · снимок на {formatTime(widgets.data.snapshot_at)}</p>
      {rows.length === 0 ? (
        <p>Установок пока нет</p>
      ) : (
        rows.map((row) => (
          <Widget
            key={row.id}
            row={row}
            selected={selected}
            canRenew={canRenew && row.lifecycle === 'current'}
            actions={actions}
          />
        ))
      )}
      <div className={styles.actions}>
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
    </div>
  )
}

function Widget({
  row,
  selected,
  canRenew,
  actions,
}: {
  row: AccountWidget
  selected: AccountLocation
  canRenew: boolean
  actions: AccountActions
}) {
  return (
    <section className={styles.panel}>
      <h3>{row.product_name || row.product_code}</h3>
      <dl className={styles.facts}>
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
      {canRenew ? (
        <AccountForm
          {...actions}
          id={selected.id + ':renewal:' + row.product_id}
          title="Ручное продление"
          version={row.entitlement_version}
          initial={{ until: '', reason: '' }}
          current={
            <p>
              Текущий срок: {row.access.valid_until ? formatTime(row.access.valid_until) : '—'}.
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
    </section>
  )
}

function Users({
  selected,
  scope,
  onExpired,
  onForbidden,
}: Pick<Props, 'selected' | 'scope' | 'onExpired' | 'onForbidden'>) {
  const users = useQuery({
    queryKey: [...accountsKey, scope, selected.id, 'crm-users'],
    queryFn: ({ signal }) => listUsers(selected.id, signal),
    retry: false,
  })
  useAccountAccessError(users.error, onExpired, onForbidden)
  if (users.isError) return <ReadFailure error={users.error} retry={() => void users.refetch()} />
  if (users.isPending) return <p role="status">Загружаем пользователей…</p>
  return (
    <AccountEvidence title="Пользователи amoCRM" value={users.data}>
      {(items) =>
        items.length === 0 ? (
          <p>Пользователей нет</p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Имя</th>
                  <th scope="col">ID</th>
                  <th scope="col">Активность</th>
                  <th scope="col">Администратор</th>
                </tr>
              </thead>
              <tbody>
                {items.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>{user.id}</td>
                    <td>{user.is_active ? 'Активен' : 'Неактивен'}</td>
                    <td>{user.is_admin ? 'Да' : 'Нет'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
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
    },
  }
  const tabLinks: [AccountTab, string][] = [
    ['overview', accountTabs.overview],
    ['widgets', accountTabs.widgets],
    ['portrait', accountTabs.portrait],
    ['history', accountTabs.history],
    ['users', accountTabs.users],
  ]
  const account = detail.isError ? undefined : detail.data
  return (
    <article className={styles.workspace}>
      <header className={styles.heading}>
        <div>
          <ManagerLink search={listSearch(search)} navigate={navigate}>
            К списку
          </ManagerLink>
        </div>
        <h1>
          {account?.display_name ??
            (account ? 'Аккаунт amoCRM ' + account.amo_account_id : 'Карточка клиента')}
        </h1>
        {account ? (
          <p className={styles.meta}>
            amoCRM {account.amo_account_id} · ID Platform {account.account_id}
          </p>
        ) : null}
      </header>
      {detail.isError ? (
        <ReadFailure error={detail.error} retry={() => void detail.refetch()} />
      ) : detail.isPending || !account ? (
        <p role="status">Загружаем карточку…</p>
      ) : (
        <>
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
          {selected.tab === 'overview' ? (
            <AccountOverview
              account={account}
              canWrite={grants.includes('clients.write')}
              {...actions}
            />
          ) : null}
          {selected.tab === 'widgets' ? (
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
              canWrite={
                grants.includes('clients.write') &&
                account.capabilities.some(
                  (capability) => capability.action === 'account.portrait' && capability.allowed,
                )
              }
              canConfigure={grants.includes('configuration.manage')}
              {...actions}
            />
          ) : null}
          {selected.tab === 'history' ? (
            <section aria-label="История">
              <StatusBadge domain="freshness" state="unavailable" calm />
              <p>История событий пока недоступна.</p>
            </section>
          ) : null}
          {selected.tab === 'users' ? (
            <Users
              selected={selected}
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
