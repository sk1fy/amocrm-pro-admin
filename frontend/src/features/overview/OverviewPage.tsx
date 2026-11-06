import { RefreshStatus } from '../../components/RefreshStatus'
import { Segmented } from '../../components/Segmented'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { usePushSearch, useRouteSearch } from '../../app/hooks'
import type { OverviewSearch } from '../../app/search'
import { fetchAccounts, fetchBackends, fetchJobs, fetchStats, keys } from '../../api/queries'
import type {
  BackendRegistryEntry,
  Observation as ObservationValue,
  StatsSnapshot,
} from '../../api/types'
import { Observation } from '../../components/Observation'
import styles from './OverviewPage.module.css'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { PageHeader } from '../../components/PageHeader'
import { PageSkeleton } from '../../components/PageSkeleton'
import { SourcesBanner, sourcesUnavailable } from '../../components/SourcesBanner'
import { StatusBadge } from '../../components/StatusBadge'
import { TechnicalDetails } from '../../components/TechnicalDetails'
import page from '../../components/page.module.css'
import { formatNull, formatRelativeTime, formatTime } from '../../lib/format'
import { jobLabel } from '../../lib/labels'
import { jobTitle } from '../operations/jobText'
import { lookupState, problemCodes } from '../../states'
import { plural } from '../accounts/accountText'
import {
  backendAbsenceReason,
  partitionAttention,
  problemNextAction,
  type AttentionItem,
} from './attention'

const failedStatuses = ['failed', 'dead']
const periods = [
  { value: '24h', label: '24 часа', short: '24 ч' },
  { value: '7d', label: '7 дней', short: '7 дн' },
  { value: '30d', label: '30 дней', short: '30 дн' },
] as const

function primaryStats(
  items: ObservationValue<StatsSnapshot>[] | undefined,
): ObservationValue<StatsSnapshot> | undefined {
  return items?.find((item) => item.data) ?? items?.[0]
}

/** Queue counts summed by status: the per-type table is a technical detail. */
export function queueTotals(queues: StatsSnapshot['queues']): Array<[string, number]> {
  const totals = new Map<string, number>()
  for (const queue of queues) {
    totals.set(queue.status, (totals.get(queue.status) ?? 0) + queue.count)
  }
  return [...totals.entries()]
}

export function OverviewPage() {
  const search = useRouteSearch<OverviewSearch>()
  const pushSearch = usePushSearch()
  const period = search.period ?? '24h'
  const periodLabel = periods.find((item) => item.value === period)?.label ?? period
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
  const unavailableBackends =
    backends.error || !backends.data
      ? null
      : backends.data.items.filter((item) => item.status === 'unavailable').length

  return (
    <div className={page.page}>
      <PageHeader
        title="Обзор"
        description="Что происходит на платформе и что требует внимания."
        actions={
          <Segmented
            label="Период статистики"
            options={periods.map((item) => ({ label: item.short, value: item.value }))}
            value={period}
            onChange={(value) => pushSearch('/', { period: value ?? '24h' })}
          />
        }
        refresh={
          <RefreshStatus
            updatedAt={stats.dataUpdatedAt}
            fetching={stats.isFetching}
            failed={Boolean(stats.error)}
            onRefresh={() => {
              for (const query of [stats, backends, ...problems, ...latestJobs])
                void query.refetch({ cancelRefetch: false })
            }}
          />
        }
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
        <Observation observation={statsObservation} onRetry={() => void stats.refetch()}>
          {() => (
            <div className={`${styles.strip} ${styles.embedded}`} data-testid="overview-stats">
              <Metric label="Бекенд недоступен" value={unavailableBackends} problem />
              <Metric
                label="Ошибки задач"
                value={snapshot?.job_errors}
                problem
                link={
                  <Link to="/operations" search={{ status: 'failed' }}>
                    Открыть
                  </Link>
                }
              />
              <Metric
                label="Нужна повторная авторизация"
                value={snapshot?.auth_problems}
                problem
                link={
                  <Link to="/stats/accounts" search={{ metric: 'auth_problems', period }}>
                    Открыть
                  </Link>
                }
              />
              <Metric
                label="Проблемы синхронизации"
                hint="за 7 дней"
                value={snapshot?.sync_problems}
                problem
                link={
                  <Link to="/stats/accounts" search={{ metric: 'sync_problems', period }}>
                    Открыть
                  </Link>
                }
              />
            </div>
          )}
        </Observation>
      ) : null}

      <section className={page.section} aria-labelledby="attention-title">
        <h2 id="attention-title">Требуют внимания</h2>
        {problemsPending ? (
          <PageSkeleton label="Загрузка проверок…" variant="list" />
        ) : attention.open.length === 0 ? (
          <p className={styles.allClear} role="status">
            <StatusBadge domain="connection_health" state="working" variant="dot" />
            По доступным данным открытых проблем нет.
          </p>
        ) : (
          <ul className={styles.attention}>
            {attention.open.map((item) => (
              <li key={item.problem} className={styles.attentionRow}>
                <StatusBadge domain="problem" state={item.problem} variant="dot" />
                <div className={styles.attentionText}>
                  <strong>{lookupState('problem', item.problem).label}</strong>
                  <span className={page.muted}>{problemNextAction[item.problem]}</span>
                </div>
                <span className={styles.attentionCount}>
                  {item.unavailable ? formatNull(null) : accountsLabel(item.count)}
                </span>
                <Link
                  to="/accounts"
                  search={{ problem: item.problem, origin: 'all', limit: 25 }}
                  aria-label={problemNextAction[item.problem]}
                >
                  Открыть →
                </Link>
              </li>
            ))}
          </ul>
        )}
        {attention.passed.length > 0 ? (
          <details className={styles.passed}>
            <summary>
              Пройдено проверок: {attention.passed.length} из {attentionItems.length}
            </summary>
            <ul>
              {attention.passed.map((item) => (
                <li key={item.problem}>
                  <Link to="/accounts" search={{ problem: item.problem, origin: 'all', limit: 25 }}>
                    {lookupState('problem', item.problem).label}
                  </Link>
                  : {formatNull(0)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {snapshot ? (
        <section className={page.section} aria-labelledby="usage-title">
          <div className={styles.sectionHead}>
            <h2 id="usage-title">Использование за {periodLabel}</h2>
            <Link to="/accounts" search={{ limit: 25 }}>
              Все аккаунты →
            </Link>
          </div>
          <div className={styles.strip}>
            <Metric
              label="Новые подключения"
              value={snapshot.connected}
              link={
                <Link to="/stats/accounts" search={{ metric: 'connected', period }}>
                  Открыть
                </Link>
              }
            />
            <Metric
              label="Отключения"
              value={snapshot.disconnected}
              link={
                <Link to="/stats/accounts" search={{ metric: 'disconnected', period }}>
                  Открыть
                </Link>
              }
            />
            <Metric
              label="Активные аккаунты"
              value={snapshot.active_accounts}
              link={
                <Link to="/stats/accounts" search={{ metric: 'active', period }}>
                  Открыть
                </Link>
              }
            />
          </div>
          <p className={page.muted}>
            Последнее использование:{' '}
            <time
              dateTime={snapshot.last_use_at ?? undefined}
              title={formatTime(snapshot.last_use_at)}
            >
              {formatRelativeTime(snapshot.last_use_at)}
            </time>
          </p>
          <TechnicalDetails summary="Технические показатели">
            <dl className={page.dl}>
              <dt>Проверка устарела или не выполнялась</dt>
              <dd data-testid="stat-Проверка устарела или не выполнялась">
                {formatNull(snapshot.verification?.unverified ?? null)}
              </dd>
              <dt>Временная ошибка проверки</dt>
              <dd data-testid="stat-Временная ошибка проверки">
                {formatNull(snapshot.verification?.temporary_errors ?? null)}
              </dd>
              <dt>Задержка p50, мс</dt>
              <dd data-testid="stat-Задержка p50, мс">
                {formatNull(snapshot.latency_p50_ms ?? null)}
              </dd>
            </dl>
          </TechnicalDetails>
        </section>
      ) : null}

      <div className={styles.columns}>
        <section className={page.section} aria-labelledby="backends-title">
          <div className={styles.sectionHead}>
            <h2 id="backends-title">Бекенды</h2>
            <Link to="/system">Подробнее →</Link>
          </div>
          {backends.isPending ? <PageSkeleton label="Загрузка бекендов…" variant="list" /> : null}
          {backends.error ? (
            <ErrorState error={backends.error} onRetry={() => void backends.refetch()} />
          ) : null}
          {!backends.isPending && !backends.error && (backends.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              title="Нет записей в реестре"
              description="Реестр бекендов пуст. Это не ошибка источника — в конфигурации нет ни одного адаптера."
            />
          ) : null}
          {(backends.data?.items.length ?? 0) > 0 ? (
            <ul className={styles.list}>
              {(backends.data?.items ?? []).map((item) => (
                <BackendRow key={item.backend} item={item} />
              ))}
            </ul>
          ) : null}
        </section>

        <section className={page.section} aria-labelledby="jobs-title">
          <div className={styles.sectionHead}>
            <h2 id="jobs-title">Фоновые задачи</h2>
            <Link to="/operations">Все задачи →</Link>
          </div>
          {snapshot && snapshot.queues.length > 0 ? (
            <p className={styles.totals} aria-label="Задачи по статусам">
              {queueTotals(snapshot.queues).map(([status, count]) => (
                <span key={status} className={styles.total}>
                  <StatusBadge domain="job" state={status} variant="text" />
                  <strong>{formatNull(count)}</strong>
                </span>
              ))}
            </p>
          ) : null}
          <h3 className={styles.subhead}>Последние ошибки</h3>
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
              <p className={styles.allClear} role="status">
                <StatusBadge domain="job" state="completed" variant="dot" />
                Нет задач с ошибками или исчерпанными попытками.
              </p>
            )
          ) : null}
          {recentJobs.length > 0 ? (
            <ul className={styles.list}>
              {recentJobs.map((job) => (
                <li key={job.id} className={styles.listRow}>
                  <div className={styles.rowMain}>
                    <strong title={job.type}>{jobTitle(job.type)}</strong>
                    {job.last_error_message ? (
                      <span className={page.muted}>{job.last_error_message}</span>
                    ) : null}
                  </div>
                  <StatusBadge domain="job" state={job.status} raw={job.raw} />
                  <time
                    className={page.muted}
                    dateTime={job.updated_at}
                    title={formatTime(job.updated_at)}
                  >
                    {formatRelativeTime(job.updated_at)}
                  </time>
                </li>
              ))}
            </ul>
          ) : null}
          {snapshot && snapshot.queues.length > 0 ? (
            <TechnicalDetails summary="Очереди по типам">
              <table className={page.queues}>
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
                      <td title={queue.type}>
                        {jobLabel(queue.type)} <span className={page.muted}>{queue.type}</span>
                      </td>
                      <td>
                        <StatusBadge domain="job" state={queue.status} variant="text" />
                      </td>
                      <td>{formatNull(queue.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TechnicalDetails>
          ) : null}
        </section>
      </div>
    </div>
  )
}

function accountsLabel(count: number | null): string {
  if (count === null) {
    return formatNull(null)
  }
  return `${count} ${plural(count, 'аккаунт', 'аккаунта', 'аккаунтов')}`
}

function Metric({
  label,
  value,
  hint,
  problem = false,
  link,
}: {
  label: string
  value: number | null | undefined
  hint?: string
  /** Problem counters are calm at zero and toned when above zero. */
  problem?: boolean
  link?: ReactNode
}) {
  const known = value !== null && value !== undefined
  const tone = !problem || !known ? '' : value > 0 ? styles.bad : styles.good
  return (
    <div className={styles.metric}>
      <div className={styles.metricLabel}>
        {label}
        {hint ? <span className={styles.metricHint}> · {hint}</span> : null}
      </div>
      <div className={styles.metricValueRow}>
        <span className={`${styles.metricValue} ${tone}`} data-testid={`stat-${label}`}>
          {formatNull(value ?? null)}
        </span>
        {link && known && (!problem || value > 0) ? (
          <span className={styles.metricLink}>{link}</span>
        ) : null}
      </div>
    </div>
  )
}

function BackendRow({ item }: { item: BackendRegistryEntry }) {
  const absence = backendAbsenceReason(item)
  const checked = item.checked_at || item.observed_at
  return (
    <li className={styles.listRow}>
      <div className={styles.rowMain}>
        <strong>{formatNull(item.display_name)}</strong>
        {absence ? <span className={page.muted}>{absence}</span> : null}
        {item.error && item.status !== 'unavailable' ? (
          <span className={page.muted}>{item.error.message}</span>
        ) : null}
      </div>
      <StatusBadge domain="source" state={item.status} calm />
      <time
        className={page.muted}
        dateTime={checked ?? undefined}
        title={checked ? `Проверка ${formatTime(checked)}` : undefined}
      >
        {checked ? formatRelativeTime(checked) : formatNull(null)}
      </time>
    </li>
  )
}
