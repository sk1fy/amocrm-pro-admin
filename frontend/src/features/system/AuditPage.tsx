import { useQuery } from '@tanstack/react-query'
import { usePushSearch, useRouteSearch } from '../../app/hooks'
import type { CursorSearch } from '../../app/search'
import { fetchAudit, keys } from '../../api/queries'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { FilterBar, FilterField } from '../../components/FilterBar'
import page from '../../components/page.module.css'
import { formatNull, formatTime } from '../../lib/format'
import { SystemNav } from './SystemPage'

export function AuditPage() {
  const search = useRouteSearch<CursorSearch>()
  const pushSearch = usePushSearch()
  const setSearch = (patch: Partial<CursorSearch>) => {
    pushSearch('/system/audit', { ...search, ...patch })
  }
  const params = {
    employee_id: search.employee,
    action: search.action,
    cursor: search.cursor,
    limit: 25,
  }
  const list = useQuery({
    queryKey: keys.audit(params),
    queryFn: () => fetchAudit(params),
  })
  return (
    <div className={page.page}>
      <h1>Аудит</h1>
      <SystemNav />
      <FilterBar
        onSubmit={(event) => {
          event.preventDefault()
        }}
      >
        <FilterField label="Сотрудник (UUID)">
          <input
            value={search.employee ?? ''}
            onChange={(event) =>
              setSearch({ employee: event.target.value || undefined, cursor: undefined })
            }
          />
        </FilterField>
        <FilterField label="Действие">
          <input
            value={search.action ?? ''}
            onChange={(event) =>
              setSearch({ action: event.target.value || undefined, cursor: undefined })
            }
          />
        </FilterField>
      </FilterBar>
      {list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data && list.data.items.length === 0 ? <EmptyState title="Нет записей" /> : null}
      {list.data && list.data.items.length > 0 ? (
        <DataTable
          rows={list.data.items}
          rowKey={(row) => String(row.id)}
          nextCursor={list.data.next_cursor}
          onReset={() => setSearch({ cursor: undefined })}
          onNext={() => setSearch({ cursor: list.data?.next_cursor ?? undefined })}
          columns={[
            { id: 'when', header: 'Когда', cell: (row) => formatTime(row.created_at) },
            { id: 'actor', header: 'Кто', cell: (row) => formatNull(row.actor_email) },
            { id: 'action', header: 'Действие', cell: (row) => row.action },
            { id: 'object', header: 'Объект', cell: (row) => formatNull(row.object_ref) },
            { id: 'outcome', header: 'Исход', cell: (row) => row.outcome },
          ]}
        />
      ) : null}
    </div>
  )
}
