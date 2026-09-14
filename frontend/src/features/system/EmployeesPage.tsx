import { useQuery } from '@tanstack/react-query'
import { fetchEmployees, keys } from '../../api/queries'
import { isForbidden } from '../../api/client'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { PageSkeleton } from '../../components/PageSkeleton'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatTime } from '../../lib/format'
import { employeeRoleLabels } from '../../states'
import { SystemNav } from './SystemPage'

export function EmployeesPage() {
  const list = useQuery({ queryKey: keys.employees, queryFn: fetchEmployees })
  return (
    <div className={page.page}>
      <h1>Сотрудники</h1>
      <SystemNav />
      {list.isPending ? <PageSkeleton label="Загрузка сотрудников…" /> : null}
      {list.error ? (
        isForbidden(list.error) ? (
          <ErrorState error={list.error} />
        ) : (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        )
      ) : null}
      {list.data && !isForbidden(list.error) && list.data.items.length === 0 ? (
        <EmptyState
          title="Нет сотрудников"
          description="В админке пока нет учётных записей. Новых сотрудников добавляет администратор."
        />
      ) : null}
      {list.data && !isForbidden(list.error) && list.data.items.length > 0 ? (
        <DataTable
          rows={list.data.items}
          rowKey={(row) => row.id}
          columns={[
            { id: 'email', header: 'Email', cell: (row) => row.email },
            { id: 'name', header: 'Имя', cell: (row) => row.name },
            {
              id: 'role',
              header: 'Роль',
              cell: (row) => employeeRoleLabels[row.role] ?? row.role,
            },
            {
              id: 'status',
              header: 'Статус',
              cell: (row) => <StatusBadge domain="employee_status" state={row.status} />,
            },
            { id: 'updated', header: 'Обновлён', cell: (row) => formatTime(row.updated_at) },
          ]}
        />
      ) : null}
    </div>
  )
}
