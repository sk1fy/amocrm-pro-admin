import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { fetchJob, keys } from '../../api/queries'
import type { Job } from '../../api/types'
import { DataTable } from '../../components/DataTable'
import { ErrorState } from '../../components/ErrorState'
import { Observation } from '../../components/Observation'
import { StatusBadge } from '../../components/StatusBadge'
import { formatNull, formatTime } from '../../lib/format'
import styles from './JobsTable.module.css'

export type JobRow = {
  job: Job
  backend: string
}

type Props = {
  rows: JobRow[]
  accountId?: string
  nextCursor?: string | null
  onNext?: () => void
  onReset?: () => void
}

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return formatNull(null)
  }
  return `${value} мс`
}

function JobAttempts({ backend, jobId }: { backend: string; jobId: string }) {
  const query = useQuery({
    queryKey: keys.job(backend, jobId),
    queryFn: () => fetchJob(backend, jobId),
  })
  if (query.isPending) {
    return <p className={styles.muted}>Загрузка…</p>
  }
  if (query.error) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  }
  if (!query.data) {
    return null
  }
  return (
    <Observation observation={query.data} onRetry={() => void query.refetch()}>
      {({ attempts }) =>
        attempts.length === 0 ? (
          <p className={styles.muted}>Попыток нет</p>
        ) : (
          <table className={styles.attempts}>
            <thead>
              <tr>
                <th scope="col">№</th>
                <th scope="col">Исход</th>
                <th scope="col">Начало</th>
                <th scope="col">Завершение</th>
                <th scope="col">Длительность</th>
                <th scope="col">Ошибка</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt) => (
                <tr key={attempt.id}>
                  <td>{formatNull(attempt.attempt)}</td>
                  <td>
                    <StatusBadge domain="job_outcome" state={attempt.outcome} raw={attempt.raw} />
                  </td>
                  <td>{formatTime(attempt.started_at)}</td>
                  <td>{formatTime(attempt.finished_at)}</td>
                  <td>{formatDuration(attempt.duration_ms)}</td>
                  <td>{formatNull(attempt.error_message)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </Observation>
  )
}

export function JobsTable({ rows, accountId, nextCursor, onNext, onReset }: Props) {
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => `${row.backend}:${row.job.id}`}
      nextCursor={nextCursor}
      onNext={onNext}
      onReset={onReset}
      renderDetail={(row) =>
        row.backend ? (
          <JobAttempts backend={row.backend} jobId={row.job.id} />
        ) : (
          <p className={styles.muted}>Бекенд не определён</p>
        )
      }
      columns={[
        {
          id: 'type',
          header: 'Тип',
          cell: (row) => row.job.type,
        },
        {
          id: 'status',
          header: 'Статус',
          cell: (row) => <StatusBadge domain="job" state={row.job.status} raw={row.job.raw} />,
        },
        {
          id: 'attempts',
          header: 'Попытки',
          cell: (row) => `${formatNull(row.job.attempts)}/${formatNull(row.job.max_attempts)}`,
        },
        {
          id: 'updated',
          header: 'Обновлено',
          cell: (row) => formatTime(row.job.updated_at),
        },
        {
          id: 'error',
          header: 'Ошибка',
          cell: (row) => formatNull(row.job.last_error_message),
        },
        {
          id: 'link',
          header: 'Подключение',
          cell: (row) => {
            const targetAccountId = row.job.account_id ?? accountId
            if (row.job.installation_id && row.backend && targetAccountId) {
              return (
                <Link
                  to="/accounts/$accountId/widgets/$backend/$connectionId"
                  params={{
                    accountId: targetAccountId,
                    backend: row.backend,
                    connectionId: row.job.installation_id,
                  }}
                >
                  открыть
                </Link>
              )
            }
            return formatNull(null)
          },
        },
      ]}
    />
  )
}
