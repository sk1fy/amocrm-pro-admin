import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchSessions, keys, revokeSession } from '../../api/queries'
import { DataTable } from '../../components/DataTable'
import { ErrorState } from '../../components/ErrorState'
import page from '../../components/page.module.css'
import { formatNull, formatTime } from '../../lib/format'
import { SystemNav } from './SystemPage'

export function SessionsPage() {
  const queryClient = useQueryClient()
  const list = useQuery({ queryKey: keys.sessions, queryFn: fetchSessions })
  const revoke = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.sessions })
    },
  })
  return (
    <div className={page.page}>
      <h1>Мои сессии</h1>
      <SystemNav />
      {list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data ? (
        <DataTable
          rows={list.data.items}
          rowKey={(row) => row.id}
          columns={[
            { id: 'created', header: 'Создана', cell: (row) => formatTime(row.created_at) },
            {
              id: 'seen',
              header: 'Последняя активность',
              cell: (row) => formatTime(row.last_seen_at),
            },
            { id: 'expires', header: 'Истекает', cell: (row) => formatTime(row.expires_at) },
            { id: 'ip', header: 'IP', cell: (row) => formatNull(row.ip) },
            {
              id: 'status',
              header: 'Статус',
              cell: (row) =>
                row.revoked_at ? `отозвана (${formatNull(row.revoke_reason)})` : 'активна',
            },
            {
              id: 'actions',
              header: 'Действия',
              cell: (row) =>
                row.revoked_at ? (
                  formatNull(null)
                ) : (
                  <button type="button" onClick={() => revoke.mutate(row.id)}>
                    Отозвать
                  </button>
                ),
            },
          ]}
        />
      ) : null}
    </div>
  )
}
