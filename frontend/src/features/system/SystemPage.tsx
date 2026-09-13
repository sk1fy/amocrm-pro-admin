import { useQuery } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import { fetchBackends, fetchMe, keys } from '../../api/queries'
import { ErrorState } from '../../components/ErrorState'
import { Observation } from '../../components/Observation'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull } from '../../lib/format'

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
      {(backends.data?.items ?? []).map((item) => (
        <Observation
          key={item.source}
          title={item.source}
          observation={item}
          onRetry={() => void backends.refetch()}
        >
          {(health) => (
            <dl className={page.dl}>
              <dt>Состояние</dt>
              <dd>
                <StatusBadge domain="freshness" state={item.freshness} />
              </dd>
              <dt>Ревизия</dt>
              <dd>{formatNull(health.revision)}</dd>
              <dt>Контракт</dt>
              <dd>{formatNull(health.contract_version)}</dd>
              <dt>Возможности</dt>
              <dd>
                {health.capabilities && health.capabilities.length > 0
                  ? health.capabilities.join(', ')
                  : formatNull(null)}
              </dd>
            </dl>
          )}
        </Observation>
      ))}
    </div>
  )
}
