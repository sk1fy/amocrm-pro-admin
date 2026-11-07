import { RefreshStatus } from '../../components/RefreshStatus'
import { useQuery } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import { fetchBackends, fetchMe, keys } from '../../api/queries'
import { ErrorState } from '../../components/ErrorState'
import { PageHeader } from '../../components/PageHeader'
import page from '../../components/page.module.css'
import { exploreURL } from '../../lib/observability'
import { BackendRegistry } from './BackendRegistry'

export function SystemNav() {
  const me = useQuery({ queryKey: keys.me, queryFn: fetchMe })
  const admin = me.data?.role === 'admin'
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const tabs = [
    { to: '/system', label: 'Бекенды' },
    { to: '/system/employees', label: 'Сотрудники', adminOnly: true },
    { to: '/system/sessions', label: 'Сессии' },
    { to: '/system/audit', label: 'Аудит' },
  ]
  return (
    <nav className={page.tabs} aria-label="Система">
      {tabs
        .filter((tab) => !tab.adminOnly || admin)
        .map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className={pathname === tab.to ? `${page.tab} ${page.tabActive}` : page.tab}
            aria-current={pathname === tab.to ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        ))}
    </nav>
  )
}

export function SystemPage() {
  const backends = useQuery({ queryKey: keys.backends, queryFn: fetchBackends })
  const observability = backends.data?.observability
  const grafana = exploreURL(observability?.grafana_base_url, 'now-6h', 'now', '')
  const loki = exploreURL(observability?.loki_base_url, 'now-6h', 'now', '')
  return (
    <div className={page.page}>
      <PageHeader
        title="Система"
        description="Бекенды админки, сотрудники, сессии и аудит."
        actions={
          grafana || loki ? (
            <>
              {grafana ? <a href={grafana}>Grafana</a> : null}
              {loki ? <a href={loki}>Loki</a> : null}
            </>
          ) : null
        }
        refresh={
          <RefreshStatus
            updatedAt={backends.dataUpdatedAt}
            fetching={backends.isFetching}
            failed={Boolean(backends.error) && backends.data !== undefined}
            onRefresh={() => void backends.refetch({ cancelRefetch: false })}
          />
        }
      />
      <SystemNav />
      {backends.isPending ? <div className={page.skeleton} /> : null}
      {backends.error && !backends.data ? (
        <ErrorState error={backends.error} onRetry={() => void backends.refetch()} />
      ) : null}
      {backends.data ? <BackendRegistry items={backends.data.items} /> : null}
    </div>
  )
}
