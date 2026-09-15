import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchSessions, keys, revokeSession } from '../../api/queries'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { PageSkeleton } from '../../components/PageSkeleton'
import page from '../../components/page.module.css'
import { formatNull, formatTime } from '../../lib/format'
import { SystemNav } from './SystemPage'
import styles from './SessionsPage.module.css'

export function SessionsPage() {
  const queryClient = useQueryClient()
  const list = useQuery({ queryKey: keys.sessions, queryFn: fetchSessions })
  const dialog = useRef<HTMLDialogElement>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const revoke = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.sessions })
    },
  })

  function openRevoke(id: string) {
    setTargetId(id)
    dialog.current?.showModal()
  }

  function closeRevoke() {
    dialog.current?.close()
    setTargetId(null)
  }

  function confirmRevoke() {
    if (!targetId) {
      return
    }
    revoke.mutate(targetId)
    closeRevoke()
  }

  return (
    <div className={page.page}>
      <h1>Мои сессии</h1>
      <SystemNav />
      {list.isPending ? <PageSkeleton label="Загрузка сессий…" /> : null}
      {list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data && list.data.items.length === 0 ? (
        <EmptyState title="Нет сессий" description="Активных сессий этого сотрудника нет." />
      ) : null}
      {list.data && list.data.items.length > 0 ? (
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
                  <button
                    type="button"
                    className={styles.danger}
                    onClick={() => openRevoke(row.id)}
                  >
                    Отозвать…
                  </button>
                ),
            },
          ]}
        />
      ) : null}
      {revoke.error ? <ErrorState error={revoke.error} /> : null}
      <dialog ref={dialog} className={styles.dialog} onClose={() => setTargetId(null)}>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault()
            confirmRevoke()
          }}
        >
          <h2>Отозвать сессию</h2>
          <p>
            <strong>Объект:</strong> сессия {targetId ?? formatNull(null)}
          </p>
          <p>
            <strong>Область воздействия:</strong> только эта сессия текущего сотрудника.
          </p>
          <p className={styles.warning}>
            Сессия сразу станет недействительной. С этого устройства потребуется новый вход. Другие
            сессии не изменятся.
          </p>
          <div className={styles.actions}>
            <button type="button" onClick={closeRevoke}>
              Отмена
            </button>
            <button type="submit" className={styles.danger} disabled={revoke.isPending}>
              Отозвать
            </button>
          </div>
        </form>
      </dialog>
    </div>
  )
}
