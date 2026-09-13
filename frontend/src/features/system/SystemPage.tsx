import { useQuery } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import { fetchBackends, fetchMe, keys } from '../../api/queries'
import { ErrorState } from '../../components/ErrorState'
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
  return (
    <div className={page.page}>
      <h1>Система</h1>
      <SystemNav />
      {backends.isPending ? <div className={page.skeleton} /> : null}
      {backends.error ? (
        <ErrorState error={backends.error} onRetry={() => void backends.refetch()} />
      ) : null}
      {backends.data?.observability.grafana_base_url ||
      backends.data?.observability.loki_base_url ? (
        <p className={page.row}>
          {exploreURL(backends.data.observability.grafana_base_url, 'now-6h', 'now', '') ? (
            <a href={exploreURL(backends.data.observability.grafana_base_url, 'now-6h', 'now', '')}>
              Grafana
            </a>
          ) : null}
          {exploreURL(backends.data.observability.loki_base_url, 'now-6h', 'now', '') ? (
            <a href={exploreURL(backends.data.observability.loki_base_url, 'now-6h', 'now', '')}>
              Loki
            </a>
          ) : null}
        </p>
      ) : null}
      {backends.data ? <BackendRegistry items={backends.data.items} /> : null}
    </div>
  )
}
