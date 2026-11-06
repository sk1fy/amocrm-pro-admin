import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePushSearch, useRouteSearch } from '../../app/hooks'
import type { CursorSearch } from '../../app/search'
import { fetchCatalog, fetchJobs, keys } from '../../api/queries'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { PageHeader } from '../../components/PageHeader'
import { RefreshStatus } from '../../components/RefreshStatus'
import { SourcesBanner, allSourcesUnavailable } from '../../components/SourcesBanner'
import { SourcesCaption } from '../../components/SourcesCaption'
import page from '../../components/page.module.css'
import { JobFilters } from './JobFilters'
import { JobsTable } from './JobsTable'
import { OperationsNav } from './OperationsNav'

export function OperationsPage() {
  const search = useRouteSearch<CursorSearch>()
  const pushSearch = usePushSearch()
  const [since] = useState(() => new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
  const setSearch = (patch: Partial<CursorSearch>) => {
    pushSearch('/operations', { ...search, ...patch })
  }
  const limit = search.limit ?? 25
  const catalog = useQuery({ queryKey: keys.catalog, queryFn: fetchCatalog })
  const params = {
    status: search.status,
    type: search.type,
    backend: search.backend,
    since,
    cursor: search.cursor,
    limit,
  }
  const jobs = useQuery({
    queryKey: keys.jobs(params),
    queryFn: () => fetchJobs(params),
  })
  const sources = jobs.data?.sources ?? []
  const rows = (jobs.data?.items ?? []).map((job) => ({
    job,
    backend: search.backend ?? (sources.length === 1 ? (sources[0]?.backend ?? '') : ''),
  }))
  const filtered = Boolean(search.status || search.type || search.backend)

  return (
    <div className={page.page}>
      <PageHeader
        title="Операции"
        description={
          <span title="Core хранит задачи 7 суток (retention), поэтому список ограничен этим окном">
            Фоновые задачи бекендов за последние 7 суток, сначала новые.
          </span>
        }
        refresh={
          <RefreshStatus
            updatedAt={jobs.dataUpdatedAt}
            fetching={jobs.isFetching}
            failed={Boolean(jobs.error) && jobs.data !== undefined}
            onRefresh={() => void jobs.refetch({ cancelRefetch: false })}
            sources={sources}
          />
        }
      />
      <OperationsNav />
      <JobFilters
        key={search.type ?? ''}
        values={{ status: search.status, type: search.type, backend: search.backend }}
        backends={catalog.data?.backends ?? []}
        onChange={(patch) => setSearch({ ...patch, cursor: undefined })}
        onReset={() => pushSearch('/operations', { limit: search.limit })}
      />
      <SourcesBanner sources={jobs.data?.sources} />
      {jobs.isPending ? <div className={page.skeleton} /> : null}
      {jobs.error && !jobs.data ? (
        <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />
      ) : null}
      {jobs.data && jobs.data.items.length === 0 ? (
        allSourcesUnavailable(jobs.data.sources) ? (
          <EmptyState
            title="Источник недоступен"
            description="Задачи нельзя показать, пока бекенд не ответит. Это не пустой список."
          />
        ) : filtered ? (
          <EmptyState
            title="Нет задач по фильтрам"
            description="Источник ответил, но задач с такими условиями за 7 суток нет."
          />
        ) : (
          <EmptyState title="Нет задач" description="Источник ответил, задач за 7 суток нет." />
        )
      ) : null}
      {jobs.data && jobs.data.items.length > 0 ? (
        <>
          <SourcesCaption sources={jobs.data.sources} />
          <JobsTable
            rows={rows}
            nextCursor={jobs.data.next_cursor}
            onReset={() => setSearch({ cursor: undefined })}
            resetDisabled={!search.cursor}
            onNext={() => setSearch({ cursor: jobs.data?.next_cursor ?? undefined })}
            total={jobs.data.total}
            limit={limit}
            onLimitChange={(next) => setSearch({ limit: next, cursor: undefined })}
          />
        </>
      ) : null}
    </div>
  )
}
