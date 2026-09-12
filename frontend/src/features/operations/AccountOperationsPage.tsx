import { useQueries, useQuery } from '@tanstack/react-query'
import { useRouteParams, useRouteSearch } from '../../app/hooks'
import type { CursorSearch } from '../../app/search'
import { fetchAccount, fetchConnectionJobs, keys } from '../../api/queries'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { SourcesBanner } from '../../components/SourcesBanner'
import { JobsTable } from './JobsTable'
import page from '../../components/page.module.css'

export function AccountOperationsPage() {
  const { accountId } = useRouteParams<{ accountId: string }>()
  const search = useRouteSearch<CursorSearch>()
  const account = useQuery({
    queryKey: keys.account(accountId),
    queryFn: () => fetchAccount(accountId),
  })
  const connections = (account.data?.connections ?? [])
    .map((obs) => obs.data)
    .filter((item): item is NonNullable<typeof item> => item !== null && item !== undefined)
  const jobQueries = useQueries({
    queries: connections.map((conn) => ({
      queryKey: keys.connectionJobs(conn.backend, conn.connection_id, {
        status: search.status,
        limit: 50,
      }),
      queryFn: () =>
        fetchConnectionJobs(conn.backend, conn.connection_id, {
          status: search.status,
          limit: 50,
        }),
      enabled: account.isSuccess,
    })),
  })
  const jobs = jobQueries.flatMap((query, index) =>
    (query.data?.items ?? []).map((job) => ({ job, backend: connections[index]?.backend })),
  )
  jobs.sort((a, b) => (a.job.updated_at < b.job.updated_at ? 1 : -1))
  const error = jobQueries.find((query) => query.error)?.error
  const sources = jobQueries.flatMap((query) => query.data?.sources ?? [])

  return (
    <div className={page.page}>
      <SourcesBanner sources={sources} />
      {error ? <ErrorState error={error} /> : null}
      {jobs.length === 0 ? <EmptyState title="Нет задач по этому аккаунту" /> : null}
      {jobs.length > 0 ? (
        <JobsTable
          jobs={jobs.map((item) => item.job)}
          backend={jobs[0]?.backend}
          accountId={accountId}
        />
      ) : null}
    </div>
  )
}
