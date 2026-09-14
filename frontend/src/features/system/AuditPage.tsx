import { useQuery } from '@tanstack/react-query'
import { usePushSearch, useRouteSearch } from '../../app/hooks'
import type { CursorSearch } from '../../app/search'
import { fetchAudit, fetchEmployees, keys } from '../../api/queries'
import { CopyableId } from '../../components/CopyableId'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { FilterBar, FilterField, type FilterChip } from '../../components/FilterBar'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull, formatTime } from '../../lib/format'
import { auditActionKeys, auditLabel, isFailedAudit } from '../../lib/labels'
import { SystemNav } from './SystemPage'

function objectHref(ref: string | null | undefined): string | null {
  if (!ref) {
    return null
  }
  if (
    ref.startsWith('/accounts/') ||
    ref.startsWith('/operations/') ||
    ref.startsWith('/widgets/')
  ) {
    return ref
  }
  if (ref.startsWith('account:')) {
    const id = ref.slice('account:'.length)
    return id ? `/accounts/${id}` : null
  }
  return null
}

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
  const employees = useQuery({
    queryKey: keys.employees,
    queryFn: fetchEmployees,
  })
  const chips: FilterChip[] = []
  if (search.employee) {
    const person = employees.data?.items.find((item) => item.id === search.employee)
    chips.push({
      id: 'employee',
      label: 'Сотрудник',
      value: person?.email ?? search.employee,
    })
  }
  if (search.action) {
    chips.push({ id: 'action', label: 'Действие', value: auditLabel(search.action) })
  }

  return (
    <div className={page.page}>
      <h1>Аудит</h1>
      <SystemNav />
      <p className={page.row}>
        <button
          type="button"
          onClick={() => setSearch({ action: 'auth.login_failed', cursor: undefined })}
        >
          Ошибки
        </button>
        <button
          type="button"
          onClick={() => setSearch({ action: 'employee.update', cursor: undefined })}
        >
          Действия сотрудников
        </button>
      </p>
      <FilterBar
        chips={chips}
        onRemoveChip={(id) => setSearch({ [id]: undefined, cursor: undefined })}
        onReset={() => pushSearch('/system/audit', {})}
        onSubmit={(event) => event.preventDefault()}
      >
        <FilterField label="Сотрудник">
          <select
            value={search.employee ?? ''}
            onChange={(event) =>
              setSearch({ employee: event.target.value || undefined, cursor: undefined })
            }
          >
            <option value="">Все</option>
            {(employees.data?.items ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.email})
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Действие">
          <select
            value={search.action ?? ''}
            onChange={(event) =>
              setSearch({ action: event.target.value || undefined, cursor: undefined })
            }
          >
            <option value="">Все</option>
            {auditActionKeys.map((action) => (
              <option key={action} value={action}>
                {auditLabel(action)}
              </option>
            ))}
          </select>
        </FilterField>
      </FilterBar>
      {employees.error ? (
        <p className={page.muted}>
          Список сотрудников недоступен. Фильтр по сотруднику скрыт для выбора.
        </p>
      ) : null}
      {list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data && list.data.items.length === 0 ? <EmptyState title="Нет записей" /> : null}
      {list.data && list.data.items.length > 0 ? (
        <DataTable
          rows={list.data.items}
          rowKey={(row) => String(row.id)}
          nextCursor={list.data.next_cursor}
          total={list.data.total}
          resetDisabled={!search.cursor}
          onReset={() => setSearch({ cursor: undefined })}
          onNext={() => setSearch({ cursor: list.data?.next_cursor ?? undefined })}
          columns={[
            {
              id: 'when',
              header: 'Когда',
              nowrap: true,
              sortValue: (row) => row.created_at,
              cell: (row) => formatTime(row.created_at),
            },
            {
              id: 'actor',
              header: 'Кто',
              ellipsis: true,
              cell: (row) => formatNull(row.actor_email),
            },
            {
              id: 'action',
              header: 'Действие',
              ellipsis: true,
              title: (row) => `${auditLabel(row.action)} ${row.action}`,
              sortValue: (row) => auditLabel(row.action),
              cell: (row) => (
                <span>
                  {auditLabel(row.action)}
                  <span className={page.muted}> {row.action}</span>
                </span>
              ),
            },
            {
              id: 'object',
              header: 'Объект',
              ellipsis: true,
              mono: true,
              title: (row) => row.object_ref ?? '',
              cell: (row) => {
                const href = objectHref(row.object_ref)
                if (href && row.object_ref) {
                  return <a href={href}>{row.object_ref}</a>
                }
                return row.object_ref ? (
                  <CopyableId value={row.object_ref} label="объекта" />
                ) : (
                  formatNull(null)
                )
              },
            },
            {
              id: 'outcome',
              header: 'Исход',
              nowrap: true,
              cell: (row) =>
                isFailedAudit(row.action, row.outcome) ? (
                  <StatusBadge domain="audit_outcome" state={row.outcome || 'failed'} />
                ) : (
                  <StatusBadge domain="audit_outcome" state={row.outcome} />
                ),
            },
          ]}
        />
      ) : null}
    </div>
  )
}
