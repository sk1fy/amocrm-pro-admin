import { useQueries, useQuery } from '@tanstack/react-query'
import { usePushSearch, useRouteParams, useRouteSearch } from '../../app/hooks'
import type { CursorSearch } from '../../app/search'
import { fetchAccount, fetchConnectionJobs, keys } from '../../api/queries'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { FilterBar, FilterField } from '../../components/FilterBar'
import { SourcesBanner } from '../../components/SourcesBanner'
import { SourcesCaption } from '../../components/SourcesCaption'
import { JobsTable } from './JobsTable'
import { jobStatuses } from './OperationsPage'
import page from '../../components/page.module.css'
import { lookupState } from '../../states'

export function AccountOperationsPage() {
  const { accountId } = useRouteParams<{ accountId: string }>()
  const search = useRouteSearch<CursorSearch>()
  const pushSearch = usePushSearch()
  const setSearch = (patch: Partial<CursorSearch>) => {
    pushSearch(`/accounts/${accountId}/operations`, { ...search, ...patch })
  }
  const limit = search.limit ?? 50
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
        type: search.type,
        limit,
      }),
      queryFn: () =>
        fetchConnectionJobs(conn.backend, conn.connection_id, {
          status: search.status,
          type: search.type,
          limit,
        }),
      enabled: account.isSuccess,
    })),
  })
  const rows = jobQueries.flatMap((query, index) =>
    (query.data?.items ?? []).map((job) => ({
      job,
      backend: connections[index]?.backend ?? '',
    })),
  )
  rows.sort((a, b) => (a.job.updated_at < b.job.updated_at ? 1 : -1))
  const firstPending = account.isPending || jobQueries.some((query) => query.isPending)
  const error = jobQueries.find((query) => query.error)?.error
  const sources = jobQueries.flatMap((query) => query.data?.sources ?? [])

  return (
    <div className={page.page}>
      <FilterBar
        onSubmit={(event) => {
          event.preventDefault()
        }}
      >
        <FilterField label="Статус">
          <select
            value={search.status ?? ''}
            onChange={(event) =>
              setSearch({ status: event.target.value || undefined, cursor: undefined })
            }
          >
            <option value="">Все</option>
            {jobStatuses.map((status) => (
              <option key={status} value={status}>
                {lookupState('job', status).label}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Тип">
          <input
            value={search.type ?? ''}
            onChange={(event) =>
              setSearch({ type: event.target.value || undefined, cursor: undefined })
            }
          />
        </FilterField>
        <FilterField label="На странице">
          <select
            value={String(limit)}
            onChange={(event) =>
              setSearch({ limit: Number(event.target.value), cursor: undefined })
            }
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </FilterField>
      </FilterBar>
      <SourcesBanner sources={sources} />
      {firstPending ? <div className={page.skeleton} /> : null}
      {error ? (
        <ErrorState
          error={error}
          onRetry={() => jobQueries.forEach((query) => void query.refetch())}
        />
      ) : null}
      {!firstPending && !error && rows.length === 0 ? (
        <EmptyState title="Нет задач по этому аккаунту" />
      ) : null}
      {!firstPending && rows.length > 0 ? (
        <>
          <SourcesCaption sources={sources} />
          <JobsTable rows={rows} accountId={accountId} />
        </>
      ) : null}
    </div>
  )
}
