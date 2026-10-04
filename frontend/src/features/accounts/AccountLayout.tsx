import { RefreshStatus } from '../../components/RefreshStatus'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useRouteParams } from '../../app/hooks'
import { useQuery } from '@tanstack/react-query'
import { fetchAccount, keys } from '../../api/queries'
import type { AccountCard } from '../../api/types'
import { ErrorState } from '../../components/ErrorState'
import { SourcesBanner } from '../../components/SourcesBanner'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull } from '../../lib/format'

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
    { to: `/accounts/${accountId}/operations`, label: 'Операции', exact: false },
    { to: `/accounts/${accountId}/history`, label: 'История', exact: false },
  ]
  const connectionPage = /\/widgets\/[^/]+\/[^/]+$/.test(pathname)

  return (
    <div className={page.page}>
      {!connectionPage ? (
        <RefreshStatus
          updatedAt={account.dataUpdatedAt}
          fetching={account.isFetching}
          failed={Boolean(account.error)}
          onRefresh={() => void account.refetch({ cancelRefetch: false })}
        />
      ) : null}
      {account.error ? (
        <ErrorState error={account.error} onRetry={() => void account.refetch()} />
      ) : null}
      {account.data ? (
        <>
          <header className={page.stack}>
            <p>
              <Link to="/accounts">Аккаунты</Link>
            </p>
            <h1>{account.data.domains[0] ?? `Аккаунт ${account.data.account_id}`}</h1>
            <div className={page.row}>
              <span className={page.muted}>Аккаунт {account.data.account_id}</span>
              <span>подключений: {formatNull(account.data.connections.length)}</span>
              <StatusBadge domain="account" state={account.data.state} />
              <StatusBadge domain="origin" state={account.data.origin} />
            </div>
            {account.data.state === 'ok' && !accountLooksFine(account.data) ? (
              <p className={page.muted}>
                Нельзя считать аккаунт исправным: есть устаревшие данные, недоступный источник или
                непроверенная авторизация. Смотрите разбивку по подключениям.
              </p>
            ) : null}
            {!connectionPage && account.data.problems.length > 0 ? (
              <div className={page.row}>
                {account.data.problems.map((problem) => (
                  <StatusBadge key={problem} domain="problem" state={problem} />
                ))}
              </div>
            ) : null}
            <SourcesBanner sources={account.data.sources} />
          </header>
          {connectionPage ? null : (
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
          )}
        </>
      ) : account.isPending ? (
        <div className={page.skeleton} />
      ) : null}
      <Outlet />
    </div>
  )
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
