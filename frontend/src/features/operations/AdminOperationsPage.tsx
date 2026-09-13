import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { usePushSearch, useRouteSearch } from '../../app/hooks'
import type { CursorSearch } from '../../app/search'
import { fetchAdminOperations, keys } from '../../api/queries'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { FilterBar, FilterField } from '../../components/FilterBar'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatTime } from '../../lib/format'
import { lookupState } from '../../states'
import { operationPending, operationStates } from './commands'
import { OperationsNav } from './OperationsNav'

export function AdminOperationsPage() {
  const search = useRouteSearch<CursorSearch>()
  const pushSearch = usePushSearch()
  const params = {
    backend: search.backend,
    target_type: search.target_type,
    target_id: search.target_id,
    state: search.state,
    command: search.command,
    cursor: search.cursor,
    limit: search.limit ?? 25,
  }
  const query = useQuery({
    queryKey: keys.adminOperations(params),
    queryFn: () => fetchAdminOperations(params),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => operationPending(item.state)) ? 1500 : false,
  })
  const change = (patch: Partial<CursorSearch>) =>
    pushSearch('/operations/admin', { ...search, ...patch, cursor: undefined })
  return (
    <div className={page.page}>
      <h1>Команды сотрудников</h1>
      <OperationsNav />
      <button type="button" onClick={() => void query.refetch()}>
        Обновить список
      </button>
      <FilterBar onSubmit={(event) => event.preventDefault()}>
        <FilterField label="Состояние">
          <select
            value={search.state ?? ''}
            onChange={(event) => change({ state: event.target.value || undefined })}
          >
            <option value="">Все</option>
            {operationStates.map((state) => (
              <option value={state} key={state}>
                {lookupState('operation', state).label}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Бекенд">
          <input
            value={search.backend ?? ''}
            onChange={(event) => change({ backend: event.target.value || undefined })}
          />
        </FilterField>
        <FilterField label="Тип объекта">
          <select
            value={search.target_type ?? ''}
            onChange={(event) => change({ target_type: event.target.value || undefined })}
          >
            <option value="">Все</option>
            <option value="installation">Подключение</option>
            <option value="integration">Интеграция</option>
            <option value="job">Задача</option>
            <option value="delivery">Доставка</option>
          </select>
        </FilterField>
        <FilterField label="ID объекта">
          <input
            value={search.target_id ?? ''}
            onChange={(event) => change({ target_id: event.target.value || undefined })}
          />
        </FilterField>
        <FilterField label="Команда">
          <input
            value={search.command ?? ''}
            onChange={(event) => change({ command: event.target.value || undefined })}
          />
        </FilterField>
      </FilterBar>
      {query.isPending ? <div className={page.skeleton} /> : null}
      {query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data?.items.length === 0 ? <EmptyState title="Операций пока нет" /> : null}
      {query.data ? (
        <DataTable
          rows={query.data.items}
          rowKey={(item) => item.id}
          nextCursor={query.data.next_cursor}
          onNext={() =>
            pushSearch('/operations/admin', {
              ...search,
              cursor: query.data?.next_cursor ?? undefined,
            })
          }
          onReset={() => change({})}
          columns={[
            {
              id: 'command',
              header: 'Команда',
              cell: (item) => (
                <Link to="/operations/admin/$operationId" params={{ operationId: item.id }}>
                  {item.command}
                </Link>
              ),
            },
            {
              id: 'object',
              header: 'Объект',
              cell: (item) => `${item.backend} · ${item.target_type} · ${item.target_id}`,
            },
            {
              id: 'state',
              header: 'Состояние',
              cell: (item) => <StatusBadge domain="operation" state={item.state} />,
            },
            { id: 'employee', header: 'Сотрудник', cell: (item) => item.employee_id },
            { id: 'created', header: 'Создано', cell: (item) => formatTime(item.created_at) },
            { id: 'updated', header: 'Обновлено', cell: (item) => formatTime(item.updated_at) },
          ]}
        />
      ) : null}
    </div>
  )
}
