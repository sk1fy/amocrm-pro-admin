import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiError } from '../../api/client'
import {
  fetchAdminOperation,
  fetchAdminOperations,
  fetchMe,
  keys,
  sendCommand,
} from '../../api/queries'
import { ErrorState } from '../../components/ErrorState'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { operationPending, type CommandSpec } from './commands'
import {
  createRequestKey,
  intentStorageKey,
  readIntent,
  writeIntent,
  type CommandIntent,
} from './intents'
import { OperationView } from './OperationView'
import styles from './CommandAction.module.css'

export type CommandField = {
  name: string
  label: string
  type?: 'text' | 'password' | 'url' | 'textarea' | 'select' | 'checkbox' | 'date' | 'number'
  value?: string
  required?: boolean
  min?: number
  max?: number
  options?: { value: string; label: string }[]
}
type Props = {
  spec: CommandSpec
  fields?: CommandField[]
  payload?: Record<string, unknown>
  buildPayload?: (data: FormData) => Record<string, unknown>
  disabled?: boolean
  disabledReason?: string
  onInspect?: () => void
  layout?: 'stack' | 'inline'
  reasonAsTooltip?: boolean
  emphasis?: 'default' | 'primary' | 'danger'
}

const affectedQueries = new Set([
  'accounts',
  'account',
  'account-history',
  'account-jobs',
  'connection',
  'connection-jobs',
  'integration',
  'integrations',
  'job',
  'jobs',
  'audit',
  'catalog',
  'backends',
  'admin-operations',
  'connection-settings',
  'connection-status',
  'connection-panels',
  'connection-employees',
  'connection-rules',
  'connection-runs',
  'stats',
  'stats-accounts',
  'views',
])

export function CommandAction(props: Props) {
  const me = useQuery({ queryKey: keys.me, queryFn: fetchMe })
  if (!me.data?.permissions.includes(props.spec.permission)) return null
  return (
    <CommandControl key={`${me.data.id}:${props.spec.path}`} {...props} employeeId={me.data.id} />
  )
}

function CommandControl({
  spec,
  fields = [],
  payload = {},
  buildPayload,
  disabled,
  disabledReason,
  onInspect,
  employeeId,
  layout = 'stack',
  reasonAsTooltip = false,
  emphasis = 'default',
}: Props & { employeeId: string }) {
  const storageKey = intentStorageKey(employeeId, spec.path)
  const [intent, setIntentState] = useState<CommandIntent | null>(() => readIntent(storageKey))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const inFlight = useRef(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const titleId = useId()
  const queryClient = useQueryClient()
  const setIntent = (next: CommandIntent | null) => {
    writeIntent(storageKey, next)
    setIntentState(next)
  }
  const lookupParams = {
    request_key: intent?.requestKey,
    backend: spec.backend,
    target_type: spec.targetType,
    target_id: spec.targetId,
    command: spec.command,
    limit: 1,
  }
  const lookup = useQuery({
    queryKey: keys.adminOperations(lookupParams),
    queryFn: () => fetchAdminOperations(lookupParams),
    enabled: Boolean(intent && !intent.operationId && !submitting),
    refetchInterval: intent && !intent.operationId && !submitting ? 1500 : false,
  })
  const operationId = intent?.operationId ?? lookup.data?.items[0]?.id
  const operationQuery = useQuery({
    queryKey: keys.adminOperation(operationId ?? ''),
    queryFn: () => fetchAdminOperation(operationId ?? ''),
    enabled: Boolean(operationId),
    refetchInterval: (query) =>
      operationPending(query.state.data?.operation.state) ? 1500 : false,
  })
  const operation = operationQuery.data?.operation ?? lookup.data?.items[0]
  const completedOperation =
    operation && !operationPending(operation.state)
      ? `${operation.id}:${operation.state}:${operation.updated_at}`
      : undefined
  useEffect(() => {
    if (intent && operationId && intent.operationId !== operationId) {
      const next = { ...intent, operationId }
      writeIntent(storageKey, next)
      setIntentState(next)
    }
  }, [intent, operationId, storageKey])
  useEffect(() => {
    if (completedOperation) {
      void queryClient.invalidateQueries({
        predicate: (query) => affectedQueries.has(String(query.queryKey[0])),
      })
    }
  }, [completedOperation, queryClient])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || intent) return
    const body = buildPayload ? buildPayload(new FormData(event.currentTarget)) : payload
    const attempt = { requestKey: createRequestKey() }
    inFlight.current = true
    setSubmitting(true)
    setError(null)
    setIntent(attempt)
    event.currentTarget.reset()
    dialog.current?.close()
    try {
      const response = await sendCommand(spec.path, body, attempt.requestKey)
      queryClient.setQueryData(keys.adminOperation(response.operation.id), response)
      void queryClient.invalidateQueries({ queryKey: ['admin-operations'] })
      setIntent({ ...attempt, operationId: response.operation.id })
    } catch (caught) {
      if (isApiError(caught) && caught.status < 500 && caught.status !== 408) {
        setIntent(null)
        setError(caught)
      }
      // A transport error leaves the request key available for read-only recovery.
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  const unresolved = Boolean(
    intent &&
      (!operation || operationPending(operation.state) || operation.state === 'unknown_outcome'),
  )
  const canStart = !submitting && !unresolved
  function open() {
    if (!canStart) return
    setIntent(null)
    setError(null)
    form.current?.reset()
    dialog.current?.showModal()
  }

  return (
    <div className={layout === 'inline' ? styles.inline : page.stack}>
      <button
        type="button"
        onClick={open}
        disabled={disabled || !canStart}
        title={disabledReason}
        className={
          emphasis === 'primary'
            ? styles.primary
            : emphasis === 'danger'
              ? styles.danger
              : undefined
        }
      >
        {operation?.state === 'partial' && spec.command === 'uninstall'
          ? 'Повторить удаление'
          : spec.label}
      </button>
      {disabledReason && !reasonAsTooltip ? (
        <span className={page.muted}>{disabledReason}</span>
      ) : null}
      {submitting ? <p role="status">Команда отправляется…</p> : null}
      {error ? <ErrorState error={error} /> : null}
      {intent && !operation && !submitting ? (
        <section className={page.card}>
          <StatusBadge domain="operation" state="unknown_outcome" />
          <p>
            Ответ на команду не получен. Проверяем сохранённую операцию по ключу запроса. Новая
            команда не отправляется.
          </p>
          {lookup.error ? (
            <ErrorState error={lookup.error} onRetry={() => void lookup.refetch()} />
          ) : null}
          <button type="button" onClick={() => void lookup.refetch()}>
            Проверить отправку
          </button>
          {onInspect ? (
            <button type="button" onClick={onInspect}>
              Проверить объект
            </button>
          ) : null}
          <Link
            to="/operations/admin"
            search={{
              backend: spec.backend,
              target_type: spec.targetType,
              target_id: spec.targetId,
            }}
          >
            История операций объекта
          </Link>
        </section>
      ) : null}
      {operationQuery.error ? (
        <ErrorState error={operationQuery.error} onRetry={() => void operationQuery.refetch()} />
      ) : null}
      {operation ? <OperationView operation={operation} onInspect={onInspect} /> : null}
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby={titleId}
        onClose={() => form.current?.reset()}
      >
        <form ref={form} className={styles.form} onSubmit={(event) => void submit(event)}>
          <h2 id={titleId}>{spec.label}</h2>
          <p>
            <strong>Объект:</strong> {spec.object}
          </p>
          <p>
            <strong>Область воздействия:</strong> {spec.scope}
          </p>
          <p className={styles.warning}>{spec.consequence}</p>
          {spec.nextStep ? (
            <p>
              <strong>Следующий шаг:</strong> {spec.nextStep}
            </p>
          ) : null}
          {fields.map((field) => (
            <label key={field.name} className={styles.field}>
              <span>{field.label}</span>
              {field.type === 'textarea' ? (
                <textarea
                  name={field.name}
                  defaultValue={field.value}
                  required={field.required}
                  rows={3}
                />
              ) : field.type === 'select' ? (
                <select name={field.name} defaultValue={field.value} required={field.required}>
                  {field.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name={field.name}
                  type={field.type ?? 'text'}
                  defaultValue={field.type === 'password' ? undefined : field.value}
                  required={field.required}
                  min={field.min}
                  max={field.max}
                  autoComplete={field.type === 'password' ? 'new-password' : 'off'}
                />
              )}
            </label>
          ))}
          <div className={styles.actions}>
            <button type="button" onClick={() => dialog.current?.close()}>
              Отмена
            </button>
            <button type="submit" disabled={submitting}>
              Подтвердить
            </button>
          </div>
        </form>
      </dialog>
    </div>
  )
}
