import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { fetchJob, keys } from '../../api/queries'
import type { Job } from '../../api/types'
import { CopyableId } from '../../components/CopyableId'
import { DataTable } from '../../components/DataTable'
import { DetailDrawer } from '../../components/DetailDrawer'
import { ErrorState } from '../../components/ErrorState'
import { Observation } from '../../components/Observation'
import { StatusBadge } from '../../components/StatusBadge'
import { formatDurationSeconds, formatNull, formatTime } from '../../lib/format'
import { actorLabel, jobLabel } from '../../lib/labels'
import styles from './JobsTable.module.css'
import { RetryJob } from './RetryActions'

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
  resetDisabled?: boolean
  total?: number | null
}

const attemptStatuses = new Set(['retry', 'failed', 'dead', 'processing'])
const errorStatuses = new Set(['failed', 'dead'])

export function jobShowsAttempts(status: string): boolean {
  return attemptStatuses.has(status)
}

export function jobShowsError(status: string): boolean {
  return errorStatuses.has(status)
}

export function jobDurationLabel(job: Job): string {
  if (!job.created_at || !job.finished_at) {
    return formatNull(null)
  }
  const started = new Date(job.created_at).getTime()
  const finished = new Date(job.finished_at).getTime()
  if (Number.isNaN(started) || Number.isNaN(finished) || finished < started) {
    return formatNull(null)
  }
  return formatDurationSeconds(Math.round((finished - started) / 1000))
}

function formatAttemptDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return formatNull(null)
  }
  return `${value} мс`
}

export function JobAttempts({ backend, jobId }: { backend: string; jobId: string }) {
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
                  <td>{formatAttemptDuration(attempt.duration_ms)}</td>
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

function JobDetailBody({ row, accountId }: { row: JobRow; accountId?: string }) {
  const job = row.job
  const targetAccountId = job.account_id ?? accountId
  return (
    <div className={styles.detail}>
      <dl>
        <dt>Задача</dt>
        <dd>
          {jobLabel(job.type)} <span className={styles.muted}>{job.type}</span>
        </dd>
        <dt>Идентификатор</dt>
        <dd>
          <CopyableId value={job.id} label="задачи" />
        </dd>
        <dt>Статус</dt>
        <dd>
          <StatusBadge domain="job" state={job.status} raw={job.raw} />
        </dd>
        <dt>Актор</dt>
        <dd>
          {actorLabel(job.actor_type)}
          {job.actor_id ? ` · ${job.actor_id}` : ''}
        </dd>
        <dt>Ресурс</dt>
        <dd>
          {formatNull(job.resource_type)}
          {job.resource_id ? ` · ${job.resource_id}` : ''}
        </dd>
        <dt>Создано</dt>
        <dd>{formatTime(job.created_at)}</dd>
        <dt>Обновлено</dt>
        <dd>{formatTime(job.updated_at)}</dd>
        <dt>Завершено</dt>
        <dd>{formatTime(job.finished_at)}</dd>
        <dt>Длительность</dt>
        <dd>{jobDurationLabel(job)}</dd>
        <dt>Попытки</dt>
        <dd>
          {jobShowsAttempts(job.status)
            ? `${formatNull(job.attempts)}/${formatNull(job.max_attempts)}`
            : formatNull(null)}
        </dd>
        <dt>Ошибка</dt>
        <dd>{jobShowsError(job.status) ? formatNull(job.last_error_message) : formatNull(null)}</dd>
      </dl>
      {job.installation_id && row.backend && targetAccountId ? (
        <Link
          to="/accounts/$accountId/widgets/$backend/$connectionId"
          params={{
            accountId: targetAccountId,
            backend: row.backend,
            connectionId: job.installation_id,
          }}
        >
          Открыть подключение
        </Link>
      ) : null}
      {row.backend ? (
        <JobAttempts backend={row.backend} jobId={job.id} />
      ) : (
        <p className={styles.muted}>Бекенд не определён</p>
      )}
    </div>
  )
}

export function JobsTable({
  rows,
  accountId,
  nextCursor,
  onNext,
  onReset,
  resetDisabled,
  total,
}: Props) {
  const [selected, setSelected] = useState<JobRow | null>(null)
  return (
    <>
      <DataTable
        rows={rows}
        rowKey={(row) => `${row.backend}:${row.job.id}`}
        nextCursor={nextCursor}
        onNext={onNext}
        onReset={onReset}
        resetDisabled={resetDisabled}
        total={total}
        onRowClick={(row) => setSelected(row)}
        columns={[
          {
            id: 'actions',
            header: 'Действия',
            nowrap: true,
            width: '8rem',
            cell: (row) => (
              <div className={styles.actions}>
                <button type="button" onClick={() => setSelected(row)}>
                  Подробнее
                </button>
                <RetryJob backend={row.backend} job={row.job} />
              </div>
            ),
          },
          {
            id: 'type',
            header: 'Задача',
            ellipsis: true,
            title: (row) => `${jobLabel(row.job.type)} ${row.job.type}`,
            sortValue: (row) => jobLabel(row.job.type),
            cell: (row) => (
              <span>
                {jobLabel(row.job.type)}
                <span className={styles.muted}> {row.job.type}</span>
              </span>
            ),
          },
          {
            id: 'status',
            header: 'Статус',
            nowrap: true,
            sortValue: (row) => row.job.status,
            cell: (row) => <StatusBadge domain="job" state={row.job.status} raw={row.job.raw} />,
          },
          {
            id: 'attempts',
            header: 'Попытки',
            nowrap: true,
            cell: (row) =>
              jobShowsAttempts(row.job.status)
                ? `${formatNull(row.job.attempts)}/${formatNull(row.job.max_attempts)}`
                : formatNull(null),
          },
          {
            id: 'duration',
            header: 'Длительность',
            nowrap: true,
            sortValue: (row) => row.job.finished_at ?? '',
            cell: (row) => jobDurationLabel(row.job),
          },
          {
            id: 'updated',
            header: 'Обновлено',
            nowrap: true,
            sortValue: (row) => row.job.updated_at,
            cell: (row) => formatTime(row.job.updated_at),
          },
          {
            id: 'error',
            header: 'Ошибка',
            ellipsis: true,
            title: (row) =>
              jobShowsError(row.job.status) ? (row.job.last_error_message ?? '') : '',
            cell: (row) =>
              jobShowsError(row.job.status)
                ? formatNull(row.job.last_error_message)
                : formatNull(null),
          },
          {
            id: 'link',
            header: 'Подключение',
            nowrap: true,
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
      <DetailDrawer
        title={selected ? jobLabel(selected.job.type) : 'Задача'}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
      >
        {selected ? <JobDetailBody row={selected} accountId={accountId} /> : null}
      </DetailDrawer>
    </>
  )
}
