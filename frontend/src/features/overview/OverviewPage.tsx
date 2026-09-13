import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useRouteSearch } from '../../app/hooks'
import type { OverviewSearch } from '../../app/search'
import { fetchAccounts, fetchBackends, fetchJobs, fetchStats, keys } from '../../api/queries'
import type { StatsSnapshot } from '../../api/types'
import { ErrorState } from '../../components/ErrorState'
import { SourcesBanner, sourcesUnavailable } from '../../components/SourcesBanner'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull, formatTime } from '../../lib/format'
import { lookupState, problemCodes } from '../../states'

const failedStatuses = ['failed', 'dead']
const periods = ['24h', '7d', '30d'] as const

function metricValue(value: number | null | undefined): string {
  return formatNull(value ?? null)
}

export function OverviewPage() {
  const search = useRouteSearch<OverviewSearch>()
  const period = search.period ?? '24h'
  const backends = useQuery({ queryKey: keys.backends, queryFn: fetchBackends })
  const stats = useQuery({ queryKey: keys.stats(period), queryFn: () => fetchStats(period) })
  const problems = useQueries({
    queries: problemCodes.map((problem) => ({
      queryKey: keys.accounts({ problem, limit: 100 }),
      queryFn: () => fetchAccounts({ problem, limit: 100 }),
    })),
  })
  const latestJobs = useQueries({
    queries: failedStatuses.map((status) => ({
      queryKey: keys.jobs({ status, limit: 10 }),
      queryFn: () => fetchJobs({ status, limit: 10 }),
    })),
  })
  const recentJobs = latestJobs
    .flatMap((query) => query.data?.items ?? [])
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    .slice(0, 10)
  const jobsPending = latestJobs.some((query) => query.isPending)
  const jobsError = latestJobs.find((query) => query.error)?.error
  const jobSources = latestJobs.flatMap((query) => query.data?.sources ?? [])

  return (
    <div className={page.page}>
      <h1>Обзор</h1>
      <section>
        <h2>Бекенды</h2>
        {backends.isPending ? <div className={page.skeleton} /> : null}
        {backends.error ? (
          <ErrorState error={backends.error} onRetry={() => void backends.refetch()} />
        ) : null}
        <div className={page.cards}>
          {(backends.data?.items ?? []).map((item) => (
            <article key={item.backend} className={page.card}>
              <h3>{formatNull(item.display_name)}</h3>
              <StatusBadge domain="source" state={item.status} />
              <p className={page.muted}>версия: {formatNull(item.revision)}</p>
              <p className={page.muted}>контракт: {formatNull(item.contract_version)}</p>
              <time dateTime={item.observed_at ?? undefined} title={item.observed_at ?? undefined}>
                {formatTime(item.observed_at)}
              </time>
              {item.error ? <p>{item.error.message}</p> : null}
            </article>
          ))}
        </div>
      </section>
      <section>
        <h2>Статистика</h2>
        <div className={page.row}>
          {periods.map((item) => (
            <Link key={item} to="/" search={{ period: item }} aria-current={item === period}>
              {item === '24h' ? '24 часа' : item === '7d' ? '7 дней' : '30 дней'}
            </Link>
          ))}
        </div>
        {stats.error ? (
          <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
        ) : null}
        {stats.isPending ? <div className={page.skeleton} /> : null}
        <div className={page.cards} data-testid="overview-stats">
          {(stats.data?.items ?? []).map((item) => {
            const snapshot = item.data
            return (
              <article key={item.source} className={page.card}>
                <h3>{item.source}</h3>
                <StatusBadge domain="freshness" state={item.freshness} />
                {snapshot ? <StatsMetrics snapshot={snapshot} period={period} /> : null}
              </article>
            )
          })}
        </div>
      </section>
      <section>
        <h2>Требуют внимания</h2>
        <div className={page.cards}>
          {problemCodes.map((problem, index) => {
            const query = problems[index]
            const unavailable = sourcesUnavailable(query.data?.sources)
            const count = query.data?.total ?? query.data?.items.length
            return (
              <Link
                key={problem}
                className={page.card}
                to="/accounts"
                search={{ problem, limit: 25 }}
              >
                <StatusBadge domain="problem" state={problem} />
                <strong>
                  {unavailable || query.error ? formatNull(null) : formatNull(count ?? null)}
                </strong>
                {unavailable ? <SourcesBanner sources={query.data?.sources} /> : null}
              </Link>
            )
          })}
        </div>
      </section>
      <section>
        <h2>Последние ошибки задач</h2>
        {jobsError ? (
          <ErrorState
            error={jobsError}
            onRetry={() => latestJobs.forEach((query) => void query.refetch())}
          />
        ) : null}
        <SourcesBanner sources={jobSources} />
        {jobsPending ? <div className={page.skeleton} /> : null}
        {!jobsPending && recentJobs.length === 0 ? (
          <p className={page.muted}>Нет задач с ошибками.</p>
        ) : null}
        {recentJobs.length > 0 ? (
          <ul>
            {recentJobs.map((job) => (
              <li key={job.id}>
                {job.type} · <StatusBadge domain="job" state={job.status} raw={job.raw} /> ·{' '}
                {formatTime(job.updated_at)}
                {job.last_error_message ? ` — ${job.last_error_message}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
        <p>
          <Link to="/operations" search={{ status: 'dead' }}>
            Задачи со статусом «{lookupState('job', 'dead').label}»
          </Link>
        </p>
      </section>
    </div>
  )
}

function StatsMetrics({ snapshot, period }: { snapshot: StatsSnapshot; period: string }) {
  const metrics: Array<{
    label: string
    value: number | null | undefined
    metric?: string
    to?: '/stats/accounts' | '/operations'
  }> = [
    {
      label: 'Новые подключения',
      value: snapshot.connected,
      metric: 'connected',
      to: '/stats/accounts',
    },
    {
      label: 'Отключения',
      value: snapshot.disconnected,
      metric: 'disconnected',
      to: '/stats/accounts',
    },
    {
      label: 'Активные аккаунты',
      value: snapshot.active_accounts,
      metric: 'active',
      to: '/stats/accounts',
    },
    { label: 'Ошибки задач', value: snapshot.job_errors, to: '/operations' },
    { label: 'Задержка p50, мс', value: snapshot.latency_p50_ms },
    {
      label: 'Проблемы авторизации',
      value: snapshot.auth_problems,
      metric: 'auth_problems',
      to: '/stats/accounts',
    },
    {
      label: 'Проблемы синхронизации',
      value: snapshot.sync_problems,
      metric: 'sync_problems',
      to: '/stats/accounts',
    },
  ]
  return (
    <div className={page.stack}>
      {metrics.map((metric) => {
        const value = (
          <>
            {metric.label}:{' '}
            <strong data-testid={`stat-${metric.label}`}>{metricValue(metric.value)}</strong>
          </>
        )
        if (metric.to === '/stats/accounts' && metric.metric) {
          return (
            <Link
              key={metric.label}
              to="/stats/accounts"
              search={{ metric: metric.metric, period }}
            >
              {value}
            </Link>
          )
        }
        if (metric.to === '/operations') {
          return (
            <Link key={metric.label} to="/operations" search={{ status: 'failed' }}>
              {value}
            </Link>
          )
        }
        return <p key={metric.label}>{value}</p>
      })}
      <p>Последнее использование: {formatTime(snapshot.last_use_at)}</p>
      <table>
        <caption>Очереди</caption>
        <thead>
          <tr>
            <th>Тип</th>
            <th>Статус</th>
            <th>Число</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.queues.map((queue) => (
            <tr key={`${queue.type}:${queue.status}`}>
              <td>{queue.type}</td>
              <td>
                <StatusBadge domain="job" state={queue.status} />
              </td>
              <td>{formatNull(queue.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
