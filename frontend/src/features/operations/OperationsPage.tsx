import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePushSearch, useRouteSearch } from '../../app/hooks'
import type { CursorSearch } from '../../app/search'
import { fetchCatalog, fetchJobs, keys } from '../../api/queries'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { FilterBar, FilterField, type FilterChip } from '../../components/FilterBar'
import { SourcesBanner, allSourcesUnavailable } from '../../components/SourcesBanner'
import { SourcesCaption } from '../../components/SourcesCaption'
import { JobsTable } from './JobsTable'
import page from '../../components/page.module.css'
import { lookupState } from '../../states'
import { OperationsNav } from './OperationsNav'

export const jobStatuses = [
  'queued',
  'processing',
  'retry',
  'completed',
  'failed',
  'dead',
  'cancelled',
]

export function OperationsPage() {
  const search = useRouteSearch<CursorSearch>()
  const pushSearch = usePushSearch()
  const [since] = useState(() => new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
  const [typeDraft, setTypeDraft] = useState(search.type ?? '')
  const setSearch = (patch: Partial<CursorSearch>) => {
    pushSearch('/operations', { ...search, ...patch })
  }
  const catalog = useQuery({ queryKey: keys.catalog, queryFn: fetchCatalog })
  const params = {
    status: search.status,
    type: search.type,
    backend: search.backend,
    since,
    cursor: search.cursor,
    limit: 25,
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
  const chips: FilterChip[] = []
  if (search.status) {
    chips.push({ id: 'status', label: 'Статус', value: lookupState('job', search.status).label })
  }
  if (search.type) {
    chips.push({ id: 'type', label: 'Тип', value: search.type })
  }
  if (search.backend) {
    chips.push({ id: 'backend', label: 'Бекенд', value: search.backend })
  }
  const removeChip = (id: string) => {
    if (id === 'type') {
      setTypeDraft('')
    }
    setSearch({ [id]: undefined, cursor: undefined })
  }

  return (
    <div className={page.page}>
      <h1>Операции</h1>
      <OperationsNav />
      <p className={page.row}>
        <button
          type="button"
          onClick={() => {
            setTypeDraft('')
            setSearch({ status: 'failed', cursor: undefined })
          }}
        >
          Ошибки
        </button>
      </p>
      <FilterBar
        chips={chips}
        onRemoveChip={removeChip}
        onReset={() => {
          setTypeDraft('')
          pushSearch('/operations', {})
        }}
        onSubmit={(event) => {
          event.preventDefault()
          setSearch({ type: typeDraft || undefined, cursor: undefined })
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
            value={typeDraft}
            onChange={(event) => setTypeDraft(event.target.value)}
            name="type"
          />
        </FilterField>
        <FilterField label="Бекенд">
          <select
            value={search.backend ?? ''}
            onChange={(event) =>
              setSearch({ backend: event.target.value || undefined, cursor: undefined })
            }
          >
            <option value="">Все</option>
            {(catalog.data?.backends ?? []).map((item) => (
              <option key={item.code} value={item.code}>
                {item.display_name}
              </option>
            ))}
          </select>
        </FilterField>
        <button type="submit">Найти</button>
      </FilterBar>
      <p
        className={page.muted}
        title="Core хранит задачи 7 суток (retention), поэтому список ограничен этим окном"
      >
        Окно: последние 7 суток. Порядок строк задаёт сервер; текущая страница не переставляется,
        чтобы курсор списка оставался корректным.
      </p>
      <SourcesBanner sources={jobs.data?.sources} />
      {jobs.isPending ? <div className={page.skeleton} /> : null}
      {jobs.error ? <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} /> : null}
      {jobs.data && jobs.data.items.length === 0 ? (
        allSourcesUnavailable(jobs.data.sources) ? (
          <EmptyState title="Источник недоступен" />
        ) : (
          <EmptyState title="Нет задач" />
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
          />
        </>
      ) : null}
    </div>
  )
}
