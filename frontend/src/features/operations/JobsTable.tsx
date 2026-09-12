import { Link } from '@tanstack/react-router'
import type { Job } from '../../api/types'
import { DataTable } from '../../components/DataTable'
import { StatusBadge } from '../../components/StatusBadge'
import { formatNull, formatTime } from '../../lib/format'

type Props = {
  jobs: Job[]
  backend?: string
  accountId?: string
  nextCursor?: string | null
  onNext?: () => void
  onReset?: () => void
}

export function JobsTable({ jobs, backend, accountId, nextCursor, onNext, onReset }: Props) {
  return (
    <DataTable
      rows={jobs}
      rowKey={(job) => job.id}
      nextCursor={nextCursor}
      onNext={onNext}
      onReset={onReset}
      columns={[
        {
          id: 'type',
          header: 'Тип',
          cell: (job) => job.type,
        },
        {
          id: 'status',
          header: 'Статус',
          cell: (job) => <StatusBadge domain="job" state={job.status} raw={job.raw} />,
        },
        {
          id: 'attempts',
          header: 'Попытки',
          cell: (job) => `${formatNull(job.attempts)}/${formatNull(job.max_attempts)}`,
        },
        {
          id: 'updated',
          header: 'Обновлено',
          cell: (job) => formatTime(job.updated_at),
        },
        {
          id: 'error',
          header: 'Ошибка',
          cell: (job) => formatNull(job.last_error_message),
        },
        {
          id: 'link',
          header: 'Подключение',
          cell: (job) =>
            job.installation_id && backend && accountId ? (
              <Link
                to="/accounts/$accountId/widgets/$backend/$connectionId"
                params={{
                  accountId,
                  backend,
                  connectionId: job.installation_id,
                }}
              >
                открыть
              </Link>
            ) : (
              formatNull(job.installation_id)
            ),
        },
      ]}
    />
  )
}
