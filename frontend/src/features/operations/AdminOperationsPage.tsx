import { backendIntervals, visibleInterval } from '../../api/queryClient'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'
import { usePushSearch, useRouteSearch } from '../../app/hooks'
import type { CursorSearch } from '../../app/search'
import { fetchAdminOperations, keys } from '../../api/queries'
import { CopyableId } from '../../components/CopyableId'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { FilterBar, FilterField, type FilterChip } from '../../components/FilterBar'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatTime } from '../../lib/format'
import { lookupState } from '../../states'
import { operationPending, operationStates } from './commands'
import { OperationsNav } from './OperationsNav'

export function AdminOperationsPage() {
  const search = useRouteSearch<CursorSearch>()
  const pushSearch = usePushSearch()
  const router = useRouter()
  const [backendDraft, setBackendDraft] = useState(search.backend ?? '')
  const [targetIdDraft, setTargetIdDraft] = useState(search.target_id ?? '')
  const [commandDraft, setCommandDraft] = useState(search.command ?? '')
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
      query.state.data?.items.some((item) => operationPending(item.state))
        ? visibleInterval(backendIntervals.operation)
        : visibleInterval(backendIntervals.detail),
  })
  const change = (patch: Partial<CursorSearch>) =>
    pushSearch('/operations/admin', { ...search, ...patch, cursor: undefined })
  const chips: FilterChip[] = []
  if (search.state) {
    chips.push({
      id: 'state',
      label: 'Состояние',
      value: lookupState('operation', search.state).label,
    })
  }
  if (search.backend) {
    chips.push({ id: 'backend', label: 'Бекенд', value: search.backend })
  }
  if (search.target_type) {
    chips.push({ id: 'target_type', label: 'Тип объекта', value: search.target_type })
  }
  if (search.target_id) {
    chips.push({ id: 'target_id', label: 'ID объекта', value: search.target_id })
  }
  if (search.command) {
    chips.push({ id: 'command', label: 'Команда', value: search.command })
  }
  const removeChip = (id: string) => {
    if (id === 'backend') setBackendDraft('')
    if (id === 'target_id') setTargetIdDraft('')
    if (id === 'command') setCommandDraft('')
    change({ [id]: undefined })
  }

  return (
    <div className={page.page}>
      <h1>Команды сотрудников</h1>
      <OperationsNav />
      <p className={page.row}>
        <button type="button" onClick={() => void query.refetch()}>
          Обновить список
        </button>
        <button type="button" onClick={() => change({ state: 'failed' })}>
          Ошибки
        </button>
      </p>
      <FilterBar
        chips={chips}
        onRemoveChip={removeChip}
        onReset={() => {
          setBackendDraft('')
          setTargetIdDraft('')
          setCommandDraft('')
          pushSearch('/operations/admin', { limit: search.limit })
        }}
        onSubmit={(event) => {
          event.preventDefault()
          change({
            backend: backendDraft || undefined,
            target_id: targetIdDraft || undefined,
            command: commandDraft || undefined,
          })
        }}
      >
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
            value={backendDraft}
            onChange={(event) => setBackendDraft(event.target.value)}
            name="backend"
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
            value={targetIdDraft}
            onChange={(event) => setTargetIdDraft(event.target.value)}
            name="target_id"
          />
        </FilterField>
        <FilterField label="Команда">
          <input
            value={commandDraft}
            onChange={(event) => setCommandDraft(event.target.value)}
            name="command"
          />
        </FilterField>
        <FilterField label="На странице">
          <select
            value={String(search.limit ?? 25)}
            onChange={(event) => change({ limit: Number(event.target.value) })}
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </FilterField>
        <button type="submit">Найти</button>
      </FilterBar>
      {query.isPending ? <div className={page.skeleton} /> : null}
      {query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data?.items.length === 0 ? <EmptyState title="Операций пока нет" /> : null}
      {query.data && query.data.items.length > 0 ? (
        <DataTable
          rows={query.data.items}
          rowKey={(item) => item.id}
          nextCursor={query.data.next_cursor}
          total={query.data.total}
          resetDisabled={!search.cursor}
          onRowClick={(item) => router.history.push(`/operations/admin/${item.id}`)}
          onNext={() =>
            pushSearch('/operations/admin', {
              ...search,
              cursor: query.data?.next_cursor ?? undefined,
            })
          }
          onReset={() => pushSearch('/operations/admin', { ...search, cursor: undefined })}
          columns={[
            {
              id: 'command',
              header: 'Команда',
              nowrap: true,
              sortValue: (item) => item.command,
              cell: (item) => (
                <Link to="/operations/admin/$operationId" params={{ operationId: item.id }}>
                  {item.command}
                </Link>
              ),
            },
            {
              id: 'object',
              header: 'Объект',
              ellipsis: true,
              title: (item) => `${item.backend} · ${item.target_type} · ${item.target_id}`,
              cell: (item) => `${item.backend} · ${item.target_type} · ${item.target_id}`,
            },
            {
              id: 'state',
              header: 'Состояние',
              nowrap: true,
              sortValue: (item) => item.state,
              cell: (item) => <StatusBadge domain="operation" state={item.state} />,
            },
            {
              id: 'employee',
              header: 'Сотрудник',
              mono: true,
              cell: (item) => <CopyableId value={item.employee_id} label="сотрудника" />,
            },
            {
              id: 'created',
              header: 'Создано',
              nowrap: true,
              sortValue: (item) => item.created_at,
              cell: (item) => formatTime(item.created_at),
            },
            {
              id: 'updated',
              header: 'Обновлено',
              nowrap: true,
              sortValue: (item) => item.updated_at,
              cell: (item) => formatTime(item.updated_at),
            },
          ]}
        />
      ) : null}
    </div>
  )
}
