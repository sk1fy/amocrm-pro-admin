import { backendIntervals, visibleInterval } from '../../api/queryClient'
import { observeOperation } from '../../api/queryClient'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { AdminOperation } from '../../api/types'
import { fetchJob, keys } from '../../api/queries'
import { ErrorState } from '../../components/ErrorState'
import { Observation } from '../../components/Observation'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import styles from './OperationView.module.css'
import { formatNull, formatTime } from '../../lib/format'
import { jobPending, operationPending, safeOperationURL } from './commands'

function numberField(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function JobObservation({
  backend,
  jobId,
  operationId,
}: {
  backend: string
  jobId: string
  operationId: string
}) {
  const query = useQuery({
    queryKey: [...keys.job(backend, jobId), operationId],
    queryFn: () => fetchJob(backend, jobId),
    refetchOnMount: 'always',
    refetchInterval: (query) => {
      const observation = query.state.data
      if (
        query.state.error ||
        observation?.freshness === 'unavailable' ||
        observation?.freshness === 'unknown'
      )
        return visibleInterval(backendIntervals.detail)
      return jobPending(observation?.data?.job.status)
        ? visibleInterval(backendIntervals.operation)
        : visibleInterval(backendIntervals.detail)
    },
  })
  if (query.isPending) return <p role="status">Загрузка состояния задачи…</p>
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (!query.data) return null
  return (
    <div className={page.stack}>
      {query.isFetching ? (
        <p className={page.muted} role="status">
          Обновляется состояние задачи…
        </p>
      ) : null}
      <Observation
        title={`Задача ${jobId}`}
        observation={query.data}
        onRetry={() => void query.refetch()}
      >
        {({ job }) => (
          <div className={page.stack}>
            <div className={page.row}>
              <span>{job.type}</span>
              <StatusBadge domain="job" state={job.status} raw={job.raw} />
            </div>
            <p>
              Попытки: {formatNull(job.attempts)}/{formatNull(job.max_attempts)}
            </p>
            {jobPending(job.status) ? (
              <p>Ожидаем завершения задачи. Состояние обновляется автоматически.</p>
            ) : null}
            {job.last_error_message ? <p role="alert">{job.last_error_message}</p> : null}
            <p>Обновлено: {formatTime(job.updated_at)}</p>
            {job.account_id && job.installation_id ? (
              <Link
                to="/accounts/$accountId/widgets/$backend/$connectionId"
                params={{ accountId: job.account_id, backend, connectionId: job.installation_id }}
              >
                Проверить состояние подключения
              </Link>
            ) : null}
          </div>
        )}
      </Observation>
      <button type="button" onClick={() => void query.refetch()}>
        Обновить задачу
      </button>
    </div>
  )
}

function OperationJob({
  backend,
  jobId,
  operationId,
}: {
  backend: string
  jobId: string
  operationId: string
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={page.stack}>
      <p>Задача: {jobId}</p>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {expanded ? 'Скрыть задачу' : 'Проверить задачу'}
      </button>
      {expanded ? (
        <JobObservation backend={backend} jobId={jobId} operationId={operationId} />
      ) : null}
    </div>
  )
}

export function OperationView({
  operation,
  link = true,
  compact = false,
  onInspect,
}: {
  operation: AdminOperation
  link?: boolean
  compact?: boolean
  onInspect?: () => void
}) {
  const client = useQueryClient()
  useEffect(() => observeOperation(client, operation), [client, operation])
  const result = operation.result ?? {}
  const oauthURL = safeOperationURL(result.oauth_start_url)
  const classification =
    typeof result.classification === 'string' ? result.classification : undefined
  const observed =
    typeof result.observed_at === 'string' ? result.observed_at : operation.observed_at
  const jobDetails = (
    <>
      {typeof result.job_id === 'string' && result.job_id !== '' ? (
        <OperationJob
          key={`${operation.id}:${result.job_id}`}
          operationId={operation.id}
          backend={operation.backend}
          jobId={result.job_id}
        />
      ) : null}
      {typeof result.retry_after === 'number' ? (
        <p>Повторная проверка доступна через {result.retry_after} с.</p>
      ) : null}
    </>
  )
  const metadata = (
    <p className={page.muted}>
      Обновлено: <time dateTime={operation.updated_at}>{formatTime(operation.updated_at)}</time> ·
      источник: {formatNull(operation.backend)}
    </p>
  )
  return (
    <section
      className={`${page.card} ${compact ? `${page.compact} ${styles.compact}` : ''}`}
      aria-label="Результат операции"
      aria-live="polite"
    >
      <div className={page.row}>
        <StatusBadge domain="operation" state={operation.state} />
        {link ? (
          <Link to="/operations/admin/$operationId" params={{ operationId: operation.id }}>
            {compact ? 'Открыть операцию' : `Операция ${operation.id}`}
          </Link>
        ) : (
          <span>{operation.id}</span>
        )}
      </div>
      {operationPending(operation.state) ? (
        <p role="status">
          Команда выполняется. Операция продолжит выполняться в фоне. Результат появится в истории.
        </p>
      ) : null}
      {operation.state === 'succeeded' && !compact ? <p role="status">Команда завершена.</p> : null}
      {operation.outcome === 'queued' ? (
        <p role="status">
          Задача поставлена в очередь. Результат выполнения проверяйте по задаче и объекту.
        </p>
      ) : null}
      {operation.state === 'unknown_outcome' ? (
        <p>Исход команды неизвестен. Проверьте объект и историю операции перед новой командой.</p>
      ) : null}
      {operation.error ? <p role="alert">{operation.error.message}</p> : null}
      {operation.error?.code === 'conflict' ? (
        <p>
          Текущие значения: retention_days={formatNull(numberField(result.retention_days))},
          initial_days={formatNull(numberField(result.initial_days))}, revision=
          {formatNull(numberField(result.revision))}
        </p>
      ) : null}
      {typeof result.webhook_error === 'string' && result.webhook_error !== '' ? (
        <p>Ошибка webhook: {result.webhook_error}</p>
      ) : null}
      {classification ? (
        <div className={page.row}>
          <StatusBadge domain="verification" state={classification} />
          <time dateTime={observed ?? undefined}>{formatTime(observed)}</time>
        </div>
      ) : null}
      {compact ? (
        <details className={styles.details}>
          <summary>Подробности выполнения</summary>
          <div className={page.stack}>
            {jobDetails}
            {metadata}
          </div>
        </details>
      ) : (
        jobDetails
      )}
      {oauthURL ? (
        <a href={oauthURL} target="_blank" rel="noopener noreferrer">
          Ссылка для повторной авторизации OAuth
        </a>
      ) : null}
      {!compact ? metadata : null}
      {onInspect ? (
        <button type="button" onClick={onInspect}>
          Проверить объект
        </button>
      ) : null}
    </section>
  )
}
