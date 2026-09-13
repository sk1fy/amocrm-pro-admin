import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { fetchAccounts, fetchBackends, fetchJobs, keys } from '../../api/queries'
import { ErrorState } from '../../components/ErrorState'
import { SourcesBanner, sourcesUnavailable } from '../../components/SourcesBanner'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull, formatTime } from '../../lib/format'
import { lookupState, problemCodes } from '../../states'

const failedStatuses = ['failed', 'dead']

export function OverviewPage() {
  const backends = useQuery({ queryKey: keys.backends, queryFn: fetchBackends })
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
            <article key={item.source} className={page.card}>
              <h3>{item.data?.backend ?? item.source}</h3>
              <StatusBadge domain="freshness" state={item.freshness} />
              <p className={page.muted}>версия: {formatNull(item.data?.revision)}</p>
              <p className={page.muted}>контракт: {formatNull(item.data?.contract_version)}</p>
              <time dateTime={item.observed_at}>{formatTime(item.observed_at)}</time>
              {item.error ? <p>{item.error.message}</p> : null}
            </article>
          ))}
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
