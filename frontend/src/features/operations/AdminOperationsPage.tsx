import { backendIntervals, visibleInterval } from '../../api/queryClient'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'
import { usePushSearch, useRouteSearch } from '../../app/hooks'
import type { CursorSearch } from '../../app/search'
import {
  fetchAdminOperations,
  fetchCatalog,
  fetchEmployees,
  fetchMe,
  keys,
} from '../../api/queries'
import type { Employee, Me } from '../../api/types'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { FilterBar, FilterField, type FilterChip } from '../../components/FilterBar'
import { PageHeader } from '../../components/PageHeader'
import { RefreshStatus } from '../../components/RefreshStatus'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatTime, shortenId } from '../../lib/format'
import { lookupState } from '../../states'
import {
  commandTitle,
  operationObjectLabel,
  operationPending,
  operationStates,
  targetTypeLabel,
  targetTypes,
} from './commands'
import { OperationsNav } from './OperationsNav'
import { Segmented, type SegmentOption } from '../../components/Segmented'

const quickStates: SegmentOption[] = [
  { label: 'Все', value: undefined },
  { label: 'Ошибки', value: 'failed' },
  { label: 'Выполняются', value: 'running' },
]

/** Who started the command, in words: the current employee, a name or a short ID. */
export function employeeName(
  id: string,
  me: Me | undefined,
  employees: Employee[] | undefined,
): string {
  if (me && me.id === id) {
    return me.name ? `${me.name} (вы)` : 'Вы'
  }
  const person = employees?.find((item) => item.id === id)
  return person ? person.name || person.email : shortenId(id)
}

export function AdminOperationsPage() {
  const search = useRouteSearch<CursorSearch>()
  const pushSearch = usePushSearch()
  const router = useRouter()
  const [targetIdDraft, setTargetIdDraft] = useState(search.target_id ?? '')
  const [commandDraft, setCommandDraft] = useState(search.command ?? '')
  const limit = search.limit ?? 25
  const params = {
    backend: search.backend,
    target_type: search.target_type,
    target_id: search.target_id,
    state: search.state,
    command: search.command,
    cursor: search.cursor,
    limit,
  }
  const query = useQuery({
    queryKey: keys.adminOperations(params),
    queryFn: () => fetchAdminOperations(params),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => operationPending(item.state))
        ? visibleInterval(backendIntervals.operation)
        : visibleInterval(backendIntervals.detail),
  })
  const me = useQuery({ queryKey: keys.me, queryFn: fetchMe })
  const catalog = useQuery({ queryKey: keys.catalog, queryFn: fetchCatalog })
  // Only administrators may read the employee list; others see short IDs.
  const employees = useQuery({
    queryKey: keys.employees,
    queryFn: fetchEmployees,
    enabled: me.data?.role === 'admin',
  })
  const backends = catalog.data?.backends ?? []
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
    const backend = backends.find((item) => item.code === search.backend)
    chips.push({ id: 'backend', label: 'Бекенд', value: backend?.display_name ?? search.backend })
  }
  if (search.target_type) {
    chips.push({
      id: 'target_type',
      label: 'Объект',
      value: targetTypeLabel(search.target_type),
    })
  }
  if (search.target_id) {
    chips.push({ id: 'target_id', label: 'ID объекта', value: shortenId(search.target_id) })
  }
  if (search.command) {
    chips.push({
      id: 'command',
      label: 'Команда',
      value: commandTitle(search.target_type ?? '', search.command),
    })
  }
  const removeChip = (id: string) => {
    if (id === 'target_id') setTargetIdDraft('')
    if (id === 'command') setCommandDraft('')
    change({ [id]: undefined })
  }
  const secondaryActive = Boolean(
    search.backend || search.target_type || search.target_id || search.command,
  )
  const filtered = Boolean(search.state) || secondaryActive

  return (
    <div className={page.page}>
      <PageHeader
        title="Операции"
        description="Команды, которые сотрудники запускали из админки."
        refresh={
          <RefreshStatus
            updatedAt={query.dataUpdatedAt}
            fetching={query.isFetching}
            failed={Boolean(query.error) && query.data !== undefined}
            onRefresh={() => void query.refetch({ cancelRefetch: false })}
          />
        }
      />
      <OperationsNav />
      <FilterBar
        chips={chips}
        onRemoveChip={removeChip}
        onReset={() => {
          setTargetIdDraft('')
          setCommandDraft('')
          pushSearch('/operations/admin', { limit: search.limit })
        }}
        onSubmit={(event) => {
          event.preventDefault()
          change({
            target_id: targetIdDraft.trim() || undefined,
            command: commandDraft.trim() || undefined,
          })
        }}
        moreOpen={secondaryActive}
        more={
          <>
            <FilterField label="Бекенд">
              <select
                value={search.backend ?? ''}
                onChange={(event) => change({ backend: event.target.value || undefined })}
              >
                <option value="">Все</option>
                {backends.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.display_name}
                  </option>
                ))}
                {search.backend && !backends.some((item) => item.code === search.backend) ? (
                  <option value={search.backend}>{search.backend}</option>
                ) : null}
              </select>
            </FilterField>
            <FilterField label="Объект">
              <select
                value={search.target_type ?? ''}
                onChange={(event) => change({ target_type: event.target.value || undefined })}
              >
                <option value="">Все</option>
                {targetTypes.map((type) => (
                  <option key={type} value={type}>
                    {targetTypeLabel(type)}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="ID объекта">
              <input
                value={targetIdDraft}
                onChange={(event) => setTargetIdDraft(event.target.value)}
                name="target_id"
              />
            </FilterField>
            <FilterField label="Код команды">
              <input
                value={commandDraft}
                onChange={(event) => setCommandDraft(event.target.value)}
                name="command"
                placeholder="например, check"
              />
            </FilterField>
            <button type="submit">Найти</button>
          </>
        }
      >
        <Segmented
          label="Быстрый фильтр по состоянию"
          options={quickStates}
          value={search.state}
          onChange={(state) => change({ state })}
        />
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
      </FilterBar>
      {query.isPending ? <div className={page.skeleton} /> : null}
      {query.error && !query.data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : null}
      {query.data?.items.length === 0 ? (
        filtered ? (
          <EmptyState
            title="Нет операций по фильтрам"
            description="Команд с такими условиями нет. Измените или сбросьте фильтры."
          />
        ) : (
          <EmptyState title="Операций пока нет" />
        )
      ) : null}
      {query.data && query.data.items.length > 0 ? (
        <DataTable
          rows={query.data.items}
          rowKey={(item) => item.id}
          nextCursor={query.data.next_cursor}
          total={query.data.total}
          resetDisabled={!search.cursor}
          limit={limit}
          onLimitChange={(next) => change({ limit: next })}
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
              title: (item) => item.command,
              sortValue: (item) => commandTitle(item.target_type, item.command),
              cell: (item) => (
                <Link to="/operations/admin/$operationId" params={{ operationId: item.id }}>
                  {commandTitle(item.target_type, item.command)}
                </Link>
              ),
            },
            {
              id: 'object',
              header: 'Объект',
              nowrap: true,
              title: (item) => `${item.backend} · ${item.target_type} · ${item.target_id}`,
              cell: (item) => operationObjectLabel(item),
            },
            {
              id: 'state',
              header: 'Состояние',
              nowrap: true,
              sortValue: (item) => item.state,
              cell: (item) => <StatusBadge domain="operation" state={item.state} calm />,
            },
            {
              id: 'employee',
              header: 'Сотрудник',
              ellipsis: true,
              title: (item) => item.employee_id,
              cell: (item) => employeeName(item.employee_id, me.data, employees.data?.items),
            },
            {
              id: 'created',
              header: 'Когда',
              nowrap: true,
              sortValue: (item) => item.created_at,
              cell: (item) => formatTime(item.created_at),
            },
          ]}
        />
      ) : null}
    </div>
  )
}
