import { useQuery } from '@tanstack/react-query'
import { usePushSearch, useRouteParams, useRouteSearch } from '../../app/hooks'
import type { CursorSearch } from '../../app/search'
import { fetchAccountJobs, keys } from '../../api/queries'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { FilterBar, FilterField } from '../../components/FilterBar'
import { SourcesBanner, allSourcesUnavailable } from '../../components/SourcesBanner'
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
  const params = {
    status: search.status,
    type: search.type,
    limit,
    cursor: search.cursor,
  }
  const jobs = useQuery({
    queryKey: keys.accountJobs(accountId, params),
    queryFn: () => fetchAccountJobs(accountId, params),
  })
  const rows = (jobs.data?.items ?? []).map((job) => ({ job, backend: job.backend }))
  const sources = jobs.data?.sources ?? []

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
      {jobs.isPending ? <div className={page.skeleton} /> : null}
      {jobs.error ? <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} /> : null}
      {jobs.data && rows.length === 0 ? (
        allSourcesUnavailable(sources) ? (
          <EmptyState title="Источник недоступен" />
        ) : (
          <EmptyState title="Нет задач по этому аккаунту" />
        )
      ) : null}
      {jobs.data ? (
        <>
          <SourcesCaption sources={sources} />
          <JobsTable
            rows={rows}
            accountId={accountId}
            nextCursor={jobs.data.next_cursor}
            onNext={() => setSearch({ cursor: jobs.data?.next_cursor ?? undefined })}
            onReset={() => setSearch({ cursor: undefined })}
          />
        </>
      ) : null}
    </div>
  )
}
