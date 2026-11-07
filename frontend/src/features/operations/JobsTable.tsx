import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { fetchJob, keys } from '../../api/queries'
import type { Job } from '../../api/types'
import { CopyableId } from '../../components/CopyableId'
import { DataTable, type DataTableColumn } from '../../components/DataTable'
import { DetailDrawer } from '../../components/DetailDrawer'
import { ErrorState } from '../../components/ErrorState'
import { Observation } from '../../components/Observation'
import { StatusBadge } from '../../components/StatusBadge'
import { TechnicalDetails } from '../../components/TechnicalDetails'
import { formatDurationSeconds, formatNull, formatTime } from '../../lib/format'
import { actorLabel } from '../../lib/labels'
import { jobTitle } from './jobText'
import styles from './JobsTable.module.css'
import { RetryJob } from './RetryActions'

export type JobRow = {
  job: Job
  backend: string
}

type Props = {
  rows: JobRow[]
  /** Account context: the widget column names the connection of this account. */
  accountId?: string
  /** Connection id → widget code, from the account card. */
  widgetNames?: ReadonlyMap<string, string>
  nextCursor?: string | null
  onNext?: () => void
  onReset?: () => void
  resetDisabled?: boolean
  total?: number | null
  limit?: number
  onLimitChange?: (limit: number) => void
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

function attemptsLabel(job: Job): string {
  return `${formatNull(job.attempts)}/${formatNull(job.max_attempts)}`
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
                <th scope="col">Длительность</th>
                <th scope="col">Ошибка</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt) => (
                <tr key={attempt.id}>
                  <td>{formatNull(attempt.attempt)}</td>
                  <td>
                    <StatusBadge
                      domain="job_outcome"
                      state={attempt.outcome}
                      raw={attempt.raw}
                      calm
                    />
                  </td>
                  <td title={`Завершение: ${formatTime(attempt.finished_at)}`}>
                    {formatTime(attempt.started_at)}
                  </td>
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

/** Link to the job's connection: the widget name in account context. */
function JobConnection({
  row,
  accountId,
  widgetNames,
}: {
  row: JobRow
  accountId?: string
  widgetNames?: ReadonlyMap<string, string>
}) {
  const job = row.job
  const targetAccountId = job.account_id ?? accountId
  if (job.installation_id && row.backend && targetAccountId) {
    const name = widgetNames?.get(job.installation_id)
    const label = accountId ? (name ?? 'Подключение') : targetAccountId
    return (
      <Link
        to="/accounts/$accountId/widgets/$backend/$connectionId"
        params={{
          accountId: targetAccountId,
          backend: row.backend,
          connectionId: job.installation_id,
        }}
        title={
          accountId ? 'Открыть подключение' : `Открыть подключение аккаунта ${targetAccountId}`
        }
      >
        {label}
      </Link>
    )
  }
  if (!accountId && job.account_id) {
    return (
      <Link to="/accounts/$accountId" params={{ accountId: job.account_id }}>
        {job.account_id}
      </Link>
    )
  }
  return <>{formatNull(null)}</>
}

function JobDetailBody({
  row,
  accountId,
  widgetNames,
}: {
  row: JobRow
  accountId?: string
  widgetNames?: ReadonlyMap<string, string>
}) {
  const job = row.job
  const failed = jobShowsError(job.status)
  return (
    <div className={styles.detail}>
      <div className={styles.summary}>
        <StatusBadge domain="job" state={job.status} raw={job.raw} calm />
        <RetryJob backend={row.backend} job={job} />
        {failed && job.retry_allowed === false && job.retry_reason ? (
          <span className={styles.muted}>Повтор недоступен: {job.retry_reason}</span>
        ) : null}
      </div>
      {failed ? <p className={styles.error}>{formatNull(job.last_error_message)}</p> : null}
      <dl>
        <dt>{accountId ? 'Виджет' : 'Аккаунт'}</dt>
        <dd>
          <JobConnection row={row} accountId={accountId} widgetNames={widgetNames} />
        </dd>
        <dt>Создание</dt>
        <dd>{formatTime(job.created_at)}</dd>
        <dt>Окончание</dt>
        <dd>{formatTime(job.finished_at)}</dd>
        <dt>Длительность</dt>
        <dd>{jobDurationLabel(job)}</dd>
        {jobShowsAttempts(job.status) ? (
          <>
            <dt>Попытки</dt>
            <dd>{attemptsLabel(job)}</dd>
          </>
        ) : null}
      </dl>
      <section className={styles.section} aria-label="Попытки выполнения">
        <h3>Попытки выполнения</h3>
        {row.backend ? (
          <JobAttempts backend={row.backend} jobId={job.id} />
        ) : (
          <p className={styles.muted}>
            Бекенд задачи не определён: выберите бекенд в фильтре, чтобы увидеть попытки.
          </p>
        )}
      </section>
      <TechnicalDetails summary="Технические данные">
        <dl>
          <dt>Код задачи</dt>
          <dd>
            <code>{job.type}</code>
          </dd>
          <dt>Идентификатор</dt>
          <dd>
            <CopyableId value={job.id} label="задачи" />
          </dd>
          <dt>Бекенд</dt>
          <dd>{formatNull(row.backend)}</dd>
          <dt>Инициатор</dt>
          <dd>
            {actorLabel(job.actor_type)}
            {job.actor_id ? ` · ${job.actor_id}` : ''}
          </dd>
          <dt>Ресурс</dt>
          <dd>
            {formatNull(job.resource_type)}
            {job.resource_id ? ` · ${job.resource_id}` : ''}
          </dd>
          {job.last_error_code ? (
            <>
              <dt>Код ошибки</dt>
              <dd>
                <code>{job.last_error_code}</code>
              </dd>
            </>
          ) : null}
          <dt>Обновлено</dt>
          <dd>{formatTime(job.updated_at)}</dd>
        </dl>
      </TechnicalDetails>
    </div>
  )
}

export function JobsTable({
  rows,
  accountId,
  widgetNames,
  nextCursor,
  onNext,
  onReset,
  resetDisabled,
  total,
  limit,
  onLimitChange,
}: Props) {
  const [selected, setSelected] = useState<JobRow | null>(null)
  const closeDrawer = () => setSelected(null)
  // Optional columns appear only when some row needs them (ADR-0021).
  const showAttempts = rows.some((row) => jobShowsAttempts(row.job.status))
  const showErrors = rows.some((row) => jobShowsError(row.job.status))
  const columns: DataTableColumn<JobRow>[] = [
    {
      id: 'type',
      header: 'Задача',
      ellipsis: true,
      title: (row) => row.job.type,
      sortValue: (row) => jobTitle(row.job.type),
      cell: (row) => <span className={styles.task}>{jobTitle(row.job.type)}</span>,
    },
    {
      id: 'status',
      header: 'Статус',
      nowrap: true,
      sortValue: (row) => row.job.status,
      cell: (row) => <StatusBadge domain="job" state={row.job.status} raw={row.job.raw} calm />,
    },
    {
      id: 'connection',
      header: accountId ? 'Виджет' : 'Аккаунт',
      nowrap: true,
      cell: (row) => <JobConnection row={row} accountId={accountId} widgetNames={widgetNames} />,
    },
  ]
  if (showAttempts) {
    columns.push({
      id: 'attempts',
      header: 'Попытки',
      nowrap: true,
      title: (row) => (jobShowsAttempts(row.job.status) ? 'Сделано попыток из допустимых' : ''),
      cell: (row) => (jobShowsAttempts(row.job.status) ? attemptsLabel(row.job) : ''),
    })
  }
  if (showErrors) {
    columns.push({
      id: 'error',
      header: 'Ошибка',
      ellipsis: true,
      title: (row) => (jobShowsError(row.job.status) ? (row.job.last_error_message ?? '') : ''),
      cell: (row) =>
        jobShowsError(row.job.status) ? (
          <span className={styles.errorText}>{formatNull(row.job.last_error_message)}</span>
        ) : (
          ''
        ),
    })
  }
  columns.push(
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
  )
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
        limit={limit}
        onLimitChange={onLimitChange}
        onRowClick={(row) => setSelected(row)}
        columns={columns}
      />
      <DetailDrawer
        title={selected ? jobTitle(selected.job.type) : 'Задача'}
        open={Boolean(selected)}
        onClose={closeDrawer}
      >
        {selected ? (
          <JobDetailBody row={selected} accountId={accountId} widgetNames={widgetNames} />
        ) : null}
      </DetailDrawer>
    </>
  )
}
