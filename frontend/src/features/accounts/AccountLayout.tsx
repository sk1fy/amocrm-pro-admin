import { RefreshStatus } from '../../components/RefreshStatus'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useRouteParams } from '../../app/hooks'
import { useQuery } from '@tanstack/react-query'
import { fetchAccount, keys } from '../../api/queries'
import type { AccountCard } from '../../api/types'
import { ErrorState } from '../../components/ErrorState'
import { OriginTag } from '../../components/OriginTag'
import { PageHeader } from '../../components/PageHeader'
import { SourcesBanner } from '../../components/SourcesBanner'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { connectionsCountLabel } from './accountText'
import styles from './AccountLayout.module.css'

export function AccountLayout() {
  const { accountId } = useRouteParams<{ accountId: string }>()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const account = useQuery({
    queryKey: keys.account(accountId),
    queryFn: () => fetchAccount(accountId),
  })
  const tabs = [
    { to: `/accounts/${accountId}`, label: 'Обзор', exact: true },
    { to: `/accounts/${accountId}/widgets`, label: 'Виджеты', exact: false },
    { to: `/accounts/${accountId}/users`, label: 'Пользователи', exact: false },
    { to: `/accounts/${accountId}/operations`, label: 'Операции', exact: false },
    { to: `/accounts/${accountId}/history`, label: 'История', exact: false },
  ]
  // The connection card renders its own header with the account as context
  // (ADR-0021): one header per page.
  const connectionPage = /\/widgets\/[^/]+\/[^/]+$/.test(pathname)
  if (connectionPage) {
    return (
      <div className={page.page}>
        <Outlet />
      </div>
    )
  }

  const data = account.data
  return (
    <div className={page.page}>
      {account.error ? (
        <ErrorState error={account.error} onRetry={() => void account.refetch()} />
      ) : null}
      {data ? (
        <>
          <PageHeader
            title={data.domains[0] ?? `Аккаунт ${data.account_id}`}
            meta={
              <>
                <span>ID {data.account_id}</span>
                {data.domains.length > 1 ? (
                  <span title={data.domains.join(', ')}>
                    ещё доменов: {data.domains.length - 1}
                  </span>
                ) : null}
                <span>{connectionsCountLabel(data.connections.length)}</span>
                {data.state === 'ok' ? null : <StatusBadge domain="account" state={data.state} />}
                <OriginTag origin={data.origin} />
              </>
            }
            refresh={
              <RefreshStatus
                updatedAt={account.dataUpdatedAt}
                fetching={account.isFetching}
                failed={Boolean(account.error)}
                onRefresh={() => void account.refetch({ cancelRefetch: false })}
                sources={data.sources}
              />
            }
          />
          <AccountNotes account={data} />
          <SourcesBanner sources={data.sources} />
          <nav className={page.tabs} aria-label="Вкладки аккаунта">
            {tabs.map((tab) => {
              const active = tab.exact ? pathname === tab.to : pathname.startsWith(tab.to)
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  className={active ? `${page.tab} ${page.tabActive}` : page.tab}
                  aria-current={active ? 'page' : undefined}
                >
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </>
      ) : account.isPending ? (
        <div className={page.skeleton} />
      ) : null}
      <Outlet />
    </div>
  )
}

/** Why the account needs attention, in one line instead of a row of badges. */
function AccountNotes({ account }: { account: AccountCard }) {
  if (account.problems.length > 0) {
    return (
      <div className={styles.notes} role="note">
        <span className={styles.notesLabel}>Требует внимания:</span>
        {account.problems.map((problem) => (
          <StatusBadge key={problem} domain="problem" state={problem} />
        ))}
      </div>
    )
  }
  if (account.state === 'ok' && !accountLooksFine(account)) {
    return (
      <p className={styles.hint}>
        Нельзя считать аккаунт исправным: есть устаревшие данные, недоступный источник или
        непроверенная авторизация. Смотрите разбивку по подключениям.
      </p>
    )
  }
  return null
}

function accountLooksFine(account: AccountCard): boolean {
  if (account.problems.length > 0) {
    return false
  }
  return !account.connections.some((obs) => {
    if (obs.freshness === 'stale' || obs.freshness === 'unavailable') {
      return true
    }
    return Boolean(obs.data?.authorization?.unverified)
  })
}
