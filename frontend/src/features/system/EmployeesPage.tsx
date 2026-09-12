import { useQuery } from '@tanstack/react-query'
import { fetchEmployees, keys } from '../../api/queries'
import { isForbidden } from '../../api/client'
import { DataTable } from '../../components/DataTable'
import { ErrorState } from '../../components/ErrorState'
import page from '../../components/page.module.css'
import { formatTime } from '../../lib/format'
import { SystemNav } from './SystemPage'

export function EmployeesPage() {
  const list = useQuery({ queryKey: keys.employees, queryFn: fetchEmployees })
  return (
    <div className={page.page}>
      <h1>Сотрудники</h1>
      <SystemNav />
      {list.isPending ? <div className={page.skeleton} /> : null}
      {list.error ? (
        isForbidden(list.error) ? (
          <ErrorState error={list.error} />
        ) : (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        )
      ) : null}
      {list.data ? (
        <DataTable
          rows={list.data.items}
          rowKey={(row) => row.id}
          columns={[
            { id: 'email', header: 'Email', cell: (row) => row.email },
            { id: 'name', header: 'Имя', cell: (row) => row.name },
            { id: 'role', header: 'Роль', cell: (row) => row.role },
            { id: 'status', header: 'Статус', cell: (row) => row.status },
            { id: 'updated', header: 'Обновлён', cell: (row) => formatTime(row.updated_at) },
          ]}
        />
      ) : null}
    </div>
  )
}
