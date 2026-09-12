import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { fetchAccounts, fetchBackends, fetchJobs, keys } from '../../api/queries'
import { ErrorState } from '../../components/ErrorState'
import { SourcesBanner, sourcesUnavailable } from '../../components/SourcesBanner'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull, formatTime } from '../../lib/format'
import { problemCodes } from '../../states'

export function OverviewPage() {
  const backends = useQuery({ queryKey: keys.backends, queryFn: fetchBackends })
  const problems = useQueries({
    queries: problemCodes.map((problem) => ({
      queryKey: keys.accounts({ problem, limit: 1 }),
      queryFn: () => fetchAccounts({ problem, limit: 1 }),
    })),
  })
  const failedJobs = useQuery({
    queryKey: keys.jobs({ status: 'failed', limit: 10 }),
    queryFn: () => fetchJobs({ status: 'failed', limit: 10 }),
  })

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
            const count =
              query.data?.total === null || query.data?.total === undefined
                ? query.data?.items.length
                : query.data.total
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
        {failedJobs.error ? (
          <ErrorState error={failedJobs.error} onRetry={() => void failedJobs.refetch()} />
        ) : null}
        <SourcesBanner sources={failedJobs.data?.sources} />
        {(failedJobs.data?.items.length ?? 0) === 0 ? (
          <p className={page.muted}>Нет задач со статусом «ошибка».</p>
        ) : (
          <ul>
            {(failedJobs.data?.items ?? []).map((job) => (
              <li key={job.id}>
                {job.type} · <StatusBadge domain="job" state={job.status} raw={job.raw} /> ·{' '}
                {formatTime(job.updated_at)}
                {job.last_error_message ? ` — ${job.last_error_message}` : ''}
              </li>
            ))}
          </ul>
        )}
        <p>
          <Link to="/operations" search={{ status: 'dead' }}>
            Задачи в статусе dead
          </Link>
        </p>
      </section>
    </div>
  )
}
