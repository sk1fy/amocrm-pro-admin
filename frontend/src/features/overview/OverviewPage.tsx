import { RefreshStatus } from '../../components/RefreshStatus'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { usePushSearch, useRouteSearch } from '../../app/hooks'
import type { OverviewSearch } from '../../app/search'
import { fetchAccounts, fetchBackends, fetchJobs, fetchStats, keys } from '../../api/queries'
import type {
  BackendRegistryEntry,
  Observation as ObservationValue,
  StatsSnapshot,
} from '../../api/types'
import { CopyableId } from '../../components/CopyableId'
import { Observation } from '../../components/Observation'
import styles from './OverviewPage.module.css'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { PageSkeleton } from '../../components/PageSkeleton'
import { SourcesBanner, sourcesUnavailable } from '../../components/SourcesBanner'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull, formatRelativeTime, formatTime } from '../../lib/format'
import { jobLabel } from '../../lib/labels'
import { lookupState, problemCodes } from '../../states'
import {
  backendAbsenceReason,
  partitionAttention,
  problemNextAction,
  type AttentionItem,
} from './attention'

const failedStatuses = ['failed', 'dead']
const periods = [
  { value: '24h', label: '24 часа' },
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
] as const

function metricValue(value: number | null | undefined): string {
  return formatNull(value ?? null)
}

function primaryStats(
  items: ObservationValue<StatsSnapshot>[] | undefined,
): ObservationValue<StatsSnapshot> | undefined {
  return items?.find((item) => item.data) ?? items?.[0]
}

export function OverviewPage() {
  const search = useRouteSearch<OverviewSearch>()
  const pushSearch = usePushSearch()
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
  const jobsUnavailable = sourcesUnavailable(jobSources)
  const statsObservation = primaryStats(stats.data?.items)
  const snapshot = statsObservation?.data ?? null
  const attentionItems: AttentionItem[] = problemCodes.flatMap((problem, index) => {
    const query = problems[index]
    if (query.isPending) {
      return []
    }
    return [
      {
        problem,
        count: query.data?.total ?? query.data?.items.length ?? null,
        unavailable: Boolean(query.error) || sourcesUnavailable(query.data?.sources),
      },
    ]
  })
  const attention = partitionAttention(attentionItems)
  const problemsPending = problems.some((query) => query.isPending)

  return (
    <div className={page.page}>
      <header className={page.header}>
        <div className={page.heading}>
          <h1 className={page.title}>Обзор</h1>
          <p className={page.description}>Состояние платформы и задачи, которым нужно внимание.</p>
        </div>
        <label className={page.period}>
          <span className={page.label}>Период</span>
          <select
            aria-label="Период статистики"
            value={period}
            onChange={(event) => pushSearch('/', { period: event.target.value })}
          >
            {periods.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </header>
      <RefreshStatus
        updatedAt={stats.dataUpdatedAt}
        fetching={stats.isFetching}
        failed={Boolean(stats.error)}
        onRefresh={() => {
          for (const query of [stats, backends, ...problems, ...latestJobs])
            void query.refetch({ cancelRefetch: false })
        }}
      />

      {stats.error ? <ErrorState error={stats.error} onRetry={() => void stats.refetch()} /> : null}
      {stats.isPending ? <PageSkeleton label="Загрузка статистики…" variant="dashboard" /> : null}
      {!stats.isPending && !stats.error && !snapshot ? (
        <EmptyState
          title={
            statsObservation?.freshness === 'unavailable'
              ? 'Статистика недоступна'
              : 'Нет данных статистики'
          }
          description={
            statsObservation?.freshness === 'unavailable'
              ? 'Источник не ответил. Это не нулевые показатели — снимок получить не удалось.'
              : 'Источник не отдал снимок за период. Показатели неизвестны, а не равны нулю.'
          }
        />
      ) : null}
      {statsObservation ? (
        <Observation
          title="Состояние платформы"
          observation={statsObservation}
          onRetry={() => void stats.refetch()}
        >
          {() => (
            <div className={styles.primaryMetrics} data-testid="overview-stats">
              <Metric
                label="Бекенд недоступен"
                value={
                  backends.error || !backends.data
                    ? null
                    : backends.data.items.filter((item) => item.status === 'unavailable').length
                }
              />
              <Metric label="Ошибки задач" value={snapshot?.job_errors} to="/operations" />
              <Metric
                label="Нужна повторная авторизация"
                value={snapshot?.auth_problems}
                to="/stats/accounts"
                metric="auth_problems"
                period={period}
              />
              <Metric
                label="Проблемы синхронизации"
                value={snapshot?.sync_problems}
                to="/stats/accounts"
                metric="sync_problems"
                period={period}
              />
            </div>
          )}
        </Observation>
      ) : null}
      <section className={page.section}>
        <h2>Требуют внимания</h2>
        {problemsPending ? (
          <PageSkeleton label="Загрузка проверок…" variant="list" />
        ) : attention.open.length === 0 ? (
          <EmptyState
            title="Открытых проблем нет"
            description="По доступным данным проблем не найдено."
          />
        ) : (
          <ul className={page.problemList}>
            {attention.open.map((item) => (
              <li key={item.problem} className={styles.problemRow}>
                <StatusBadge domain="problem" state={item.problem} />
                <strong>{item.unavailable ? formatNull(null) : formatNull(item.count)}</strong>
                <Link to="/accounts" search={{ problem: item.problem, origin: 'all', limit: 25 }}>
                  {problemNextAction[item.problem]}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {attention.passed.length > 0 ? (
          <details className={page.expand}>
            <summary>Остальные проверки пройдены</summary>
            <ul className={page.problemList}>
              {attention.passed.map((item) => (
                <li key={item.problem} className={styles.problemRow}>
                  <StatusBadge domain="problem" state={item.problem} />
                  <strong>{formatNull(0)}</strong>
                  <Link to="/accounts" search={{ problem: item.problem, origin: 'all', limit: 25 }}>
                    {problemNextAction[item.problem]}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {snapshot ? (
        <section className={page.section} aria-labelledby="usage-title">
          <div className={page.header}>
            <h2 id="usage-title">Использование за период</h2>
            <Link to="/accounts" search={{ limit: 25 }}>
              Открыть аккаунты →
            </Link>
          </div>
          <div className={page.metrics}>
            <Metric
              label="Новые подключения"
              value={snapshot.connected}
              to="/stats/accounts"
              metric="connected"
              period={period}
            />
            <Metric
              label="Отключения"
              value={snapshot.disconnected}
              to="/stats/accounts"
              metric="disconnected"
              period={period}
            />
            <Metric
              label="Активные аккаунты"
              value={snapshot.active_accounts}
              to="/stats/accounts"
              metric="active"
              period={period}
            />
            <Metric
              label="Проверка устарела или не выполнялась"
              value={snapshot.verification?.unverified}
            />
            <Metric
              label="Временная ошибка проверки"
              value={snapshot.verification?.temporary_errors}
            />
            <Metric label="Задержка p50, мс" value={snapshot.latency_p50_ms} />
          </div>
          <p className={page.muted}>Последнее использование: {formatTime(snapshot.last_use_at)}</p>
        </section>
      ) : null}
      <section className={page.section}>
        <h2>Бекенды</h2>
        {backends.isPending ? (
          <PageSkeleton label="Загрузка бекендов…" variant="dashboard" />
        ) : null}
        {backends.error ? (
          <ErrorState error={backends.error} onRetry={() => void backends.refetch()} />
        ) : null}
        {!backends.isPending && !backends.error && (backends.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="Нет записей в реестре"
            description="Реестр бекендов пуст. Это не ошибка источника — в конфигурации нет ни одного адаптера."
          />
        ) : null}
        <div className={page.cardsCompact}>
          {(backends.data?.items ?? []).map((item) => (
            <BackendCard key={item.backend} item={item} />
          ))}
        </div>
      </section>

      <section className={page.section}>
        <h2>Задачи</h2>
        {snapshot && snapshot.queues.length > 0 ? (
          <table className={page.queues}>
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
                  <td>{jobLabel(queue.type)}</td>
                  <td>
                    <StatusBadge domain="job" state={queue.status} />
                  </td>
                  <td>{formatNull(queue.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <h3>Последние ошибки задач</h3>
        {jobsError ? (
          <ErrorState
            error={jobsError}
            onRetry={() => latestJobs.forEach((query) => void query.refetch())}
          />
        ) : null}
        <SourcesBanner sources={jobSources} />
        {jobsPending ? <PageSkeleton label="Загрузка ошибок задач…" variant="list" /> : null}
        {!jobsPending && !jobsError && recentJobs.length === 0 ? (
          jobsUnavailable ? (
            <EmptyState
              title="Ошибки задач недоступны"
              description="Очередь не ответила. Это не значит, что ошибок нет — источник не отдал список."
            />
          ) : (
            <EmptyState
              title="Нет задач с ошибками"
              description="В последних задачах нет ошибок или исчерпанных попыток."
            />
          )
        ) : null}
        {recentJobs.length > 0 ? (
          <ul className={page.jobList}>
            {recentJobs.map((job) => (
              <li key={job.id} className={page.jobRow}>
                <div className={page.row}>
                  <strong>{jobLabel(job.type)}</strong>
                  <StatusBadge domain="job" state={job.status} raw={job.raw} />
                  <time dateTime={job.updated_at} title={formatTime(job.updated_at)}>
                    {formatRelativeTime(job.updated_at)}
                  </time>
                </div>
                {job.last_error_message ? (
                  <p className={page.muted}>{job.last_error_message}</p>
                ) : null}
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

function Metric({
  label,
  value,
  to,
  metric,
  period,
}: {
  label: string
  value: number | null | undefined
  to?: '/stats/accounts' | '/operations'
  metric?: string
  period?: string
}) {
  const body = (
    <article className={`${page.card} ${page.metric} ${page.compact}`}>
      <div className={page.metricLabel}>{label}</div>
      <div className={page.metricValue} data-testid={`stat-${label}`}>
        {metricValue(value)}
      </div>
      {metric === 'sync_problems' ? <span className={page.muted}>За последние 7 суток</span> : null}
    </article>
  )
  if (to === '/stats/accounts' && metric) {
    return (
      <Link to="/stats/accounts" search={{ metric, period }}>
        {body}
      </Link>
    )
  }
  if (to === '/operations') {
    return (
      <Link to="/operations" search={{ status: 'failed' }}>
        {body}
      </Link>
    )
  }
  return body
}

function BackendCard({ item }: { item: BackendRegistryEntry }) {
  const absence = backendAbsenceReason(item)
  const checked = item.checked_at || item.observed_at
  return (
    <article className={`${page.card} ${page.compact}`}>
      <h3>{formatNull(item.display_name)}</h3>
      <StatusBadge domain="source" state={item.status} />
      <details className={page.expand}>
        <summary>Технические данные</summary>
        {item.revision ? (
          <CopyableId value={item.revision} label="ревизия" />
        ) : (
          <p className={page.muted}>ревизия: {formatNull(null)}</p>
        )}
        <p className={page.muted}>контракт: {formatNull(item.contract_version)}</p>
      </details>
      <time dateTime={checked ?? undefined} title={checked ? formatTime(checked) : undefined}>
        {checked ? `Проверка ${formatRelativeTime(checked)}` : formatNull(null)}
      </time>
      {absence ? <p className={page.muted}>{absence}</p> : null}
      {item.error && item.status !== 'unavailable' ? <p>{item.error.message}</p> : null}
    </article>
  )
}
