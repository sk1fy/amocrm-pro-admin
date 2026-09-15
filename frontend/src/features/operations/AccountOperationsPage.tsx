import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { usePushSearch, useRouteParams, useRouteSearch } from '../../app/hooks'
import type { CursorSearch } from '../../app/search'
import { fetchAccount, fetchAccountJobs, keys } from '../../api/queries'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { FilterBar, FilterField, type FilterChip } from '../../components/FilterBar'
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
  const [typeDraft, setTypeDraft] = useState(search.type ?? '')
  const setSearch = (patch: Partial<CursorSearch>) => {
    pushSearch(`/accounts/${accountId}/operations`, { ...search, ...patch })
  }
  const limit = search.limit ?? 50
  const account = useQuery({
    queryKey: keys.account(accountId),
    queryFn: () => fetchAccount(accountId),
  })
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
  const chips: FilterChip[] = []
  if (search.status) {
    chips.push({ id: 'status', label: 'Статус', value: lookupState('job', search.status).label })
  }
  if (search.type) {
    chips.push({ id: 'type', label: 'Тип', value: search.type })
  }

  return (
    <div className={page.page}>
      {account.data?.connections.some((item) => item.data) ? (
        <section className={page.stack} aria-label="Команды подключений аккаунта">
          <h2>Команды подключений</h2>
          {account.data.connections.map((item) =>
            item.data ? (
              <Link
                key={`${item.source}:${item.data.connection_id}`}
                to="/operations/admin"
                search={{
                  backend: item.data.backend,
                  target_type: 'installation',
                  target_id: item.data.connection_id,
                }}
              >
                {item.data.integration_code} · {item.data.backend} · история команд
              </Link>
            ) : null,
          )}
        </section>
      ) : null}
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
        onRemoveChip={(id) => {
          if (id === 'type') setTypeDraft('')
          setSearch({ [id]: undefined, cursor: undefined })
        }}
        onReset={() => {
          setTypeDraft('')
          pushSearch(`/accounts/${accountId}/operations`, { limit })
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
        <button type="submit">Найти</button>
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
      {jobs.data && rows.length > 0 ? (
        <>
          <SourcesCaption sources={sources} />
          <JobsTable
            rows={rows}
            accountId={accountId}
            nextCursor={jobs.data.next_cursor}
            onNext={() => setSearch({ cursor: jobs.data?.next_cursor ?? undefined })}
            onReset={() => setSearch({ cursor: undefined })}
            resetDisabled={!search.cursor}
            total={jobs.data.total}
          />
        </>
      ) : null}
    </div>
  )
}
