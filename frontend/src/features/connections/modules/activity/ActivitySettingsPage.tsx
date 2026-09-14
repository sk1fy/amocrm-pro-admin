import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useRouteParams } from '../../../../app/hooks'
import {
  fetchActivityEmployees,
  fetchActivityPanels,
  fetchActivitySettings,
  fetchActivityStatus,
  fetchLeadStatusRules,
  fetchLeadStatusRuns,
  keys,
} from '../../../../api/queries'
import type {
  ActivityEmployee,
  LeadStatusRule,
  LeadStatusRun,
  Observation as ObservationType,
} from '../../../../api/types'
import { BackToTop } from '../../../../components/BackToTop'
import { EmptyState } from '../../../../components/EmptyState'
import { ErrorState } from '../../../../components/ErrorState'
import { IncidentBanner } from '../../../../components/IncidentBanner'
import { Observation } from '../../../../components/Observation'
import { PageSkeleton } from '../../../../components/PageSkeleton'
import { StatusBadge } from '../../../../components/StatusBadge'
import { TechnicalDetails } from '../../../../components/TechnicalDetails'
import page from '../../../../components/page.module.css'
import { collectCoreAuthIncident, observationDependsOnIncident } from '../../../../lib/incidents'
import {
  formatDateLong,
  formatDurationSeconds,
  formatNull,
  formatRelativeTime,
  formatTime,
} from '../../../../lib/format'
import { lastSyncDurationSeconds } from '../../../../lib/connectionHealth'
import { unixFromDateInput, unixFromRFC3339 } from '../../../../lib/observability'
import { CommandAction } from '../../../operations/CommandAction'
import { connectionCommand } from '../../../operations/commands'
import styles from '../../connection.module.css'

export function ActivitySettingsPage() {
  const { accountId, backend, connectionId } = useRouteParams<{
    accountId: string
    backend: string
    connectionId: string
  }>()
  const settings = useQuery({
    queryKey: keys.activitySettings(backend, connectionId),
    queryFn: () => fetchActivitySettings(backend, connectionId),
  })
  const status = useQuery({
    queryKey: keys.activityStatus(backend, connectionId),
    queryFn: () => fetchActivityStatus(backend, connectionId),
  })
  const panels = useQuery({
    queryKey: keys.activityPanels(backend, connectionId),
    queryFn: () => fetchActivityPanels(backend, connectionId),
  })
  const employees = useQuery({
    queryKey: keys.activityEmployees(backend, connectionId),
    queryFn: () => fetchActivityEmployees(backend, connectionId),
  })
  const rules = useQuery({
    queryKey: keys.leadStatusRules(backend, connectionId),
    queryFn: () => fetchLeadStatusRules(backend, connectionId),
  })
  const runs = useQuery({
    queryKey: keys.leadStatusRuns(backend, connectionId),
    queryFn: () => fetchLeadStatusRuns(backend, connectionId),
  })

  const [dirtyRules, setDirtyRules] = useState<Record<string, boolean>>({})
  const rulesDirty = Object.values(dirtyRules).some(Boolean)
  useUnsavedChangesGuard(rulesDirty)
  const incident = collectCoreAuthIncident([
    { scope: 'settings', observation: asObservation(settings.data, backend) },
    { scope: 'sync', observation: asObservation(status.data, backend) },
    { scope: 'panels', observation: asObservation(panels.data, backend) },
    { scope: 'employees', observation: asObservation(employees.data, backend) },
  ])
  const refetchAll = () => {
    void settings.refetch()
    void status.refetch()
    void panels.refetch()
    void employees.refetch()
    void rules.refetch()
    void runs.refetch()
  }
  const sourceBlocked = Boolean(incident) || status.data?.freshness === 'unavailable'
  const dependentHint = incident ? (
    <p>
      Раздел недоступен из-за <a href="#core-incident-title">ошибки авторизации Core</a>.
    </p>
  ) : undefined
  const loading = settings.isPending || panels.isPending

  return (
    <div className={page.page}>
      <p>
        <Link
          to="/accounts/$accountId/widgets/$backend/$connectionId"
          params={{ accountId, backend, connectionId }}
          onClick={(event) => {
            if (rulesDirty && !window.confirm(unsavedLeaveMessage)) {
              event.preventDefault()
            }
          }}
        >
          Назад к подключению
        </Link>
      </p>
      <h2>Настройки Activity и lead-status</h2>
      {loading ? <PageSkeleton label="Загрузка настроек…" /> : null}
      {settings.error ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : null}
      {incident ? <IncidentBanner incident={incident} onRetry={refetchAll} /> : null}
      {sourceBlocked ? (
        <p className={page.muted}>
          Пока Core не ответит, сохранение настроек, синхронизация и изменения панелей недоступны.
          Безопасны повтор запроса и просмотр истории.
        </p>
      ) : null}
      <Observation
        title="Настройки Activity"
        observation={asObservation(settings.data, backend)}
        onRetry={() => void settings.refetch()}
        dependentHint={
          settings.data && observationDependsOnIncident(settings.data, incident)
            ? dependentHint
            : undefined
        }
      >
        {(data) => (
          <div className={page.stack}>
            <dl className={page.dl}>
              <dt>Начальная загрузка, дней</dt>
              <dd data-testid="initial-days">{formatNull(data.initial_days)}</dd>
              <dt>Хранение, дней</dt>
              <dd data-testid="retention-days">{formatNull(data.retention_days)}</dd>
            </dl>
            <CommandAction
              spec={connectionCommand(backend, connectionId, 'activity-configure', accountId)}
              layout="inline"
              disabled={sourceBlocked}
              disabledReason={sourceBlocked ? 'Сначала восстановите доступ к Core.' : undefined}
              fields={[
                {
                  name: 'initial_days',
                  label: 'Дней начальной загрузки (1–7)',
                  type: 'number',
                  value: String(data.initial_days),
                  required: true,
                  min: 1,
                  max: 7,
                },
                {
                  name: 'retention_days',
                  label: 'Дней хранения (2–30)',
                  type: 'number',
                  value: String(data.retention_days),
                  required: true,
                  min: 2,
                  max: 30,
                },
              ]}
              buildPayload={(form) => ({
                initial_days: Number(form.get('initial_days')),
                retention_days: Number(form.get('retention_days')),
                expected_updated_at: unixFromRFC3339(data.updated_at),
              })}
              onInspect={() => void settings.refetch()}
            />
          </div>
        )}
      </Observation>
      <SyncCommands
        accountId={accountId}
        backend={backend}
        connectionId={connectionId}
        status={status.data}
        blocked={sourceBlocked}
        onRetry={() => void status.refetch()}
        dependentHint={
          status.data && observationDependsOnIncident(status.data, incident)
            ? dependentHint
            : undefined
        }
      />
      <Observation
        title="Панели"
        observation={asObservation(panels.data, backend)}
        onRetry={() => void panels.refetch()}
        dependentHint={
          panels.data && observationDependsOnIncident(panels.data, incident)
            ? dependentHint
            : undefined
        }
      >
        {(items) => (
          <div className={page.stack}>
            {items.length === 0 ? <p className={page.muted}>Нет панелей</p> : null}
            {items.map((panel) => (
              <article key={panel.id} className={page.card}>
                <h4>{panel.name}</h4>
                <p>Сотрудники: {panel.employee_ids.join(', ') || formatNull(null)}</p>
                <p>
                  Окно: {panel.display_window.from}–{panel.display_window.to}
                </p>
                <StatusBadge domain="grant" state={panel.enabled ? 'granted' : 'not_granted'} />
                <TechnicalDetails>
                  <p>Версия панели: {formatNull(panel.revision)}</p>
                </TechnicalDetails>
                <CommandAction
                  spec={connectionCommand(backend, connectionId, 'activity-panel-patch', accountId)}
                  layout="inline"
                  disabled={sourceBlocked}
                  disabledReason={sourceBlocked ? 'Источник панелей недоступен.' : undefined}
                  fields={[
                    { name: 'name', label: 'Имя', value: panel.name, required: true },
                    {
                      name: 'enabled',
                      label: 'Включена',
                      type: 'select',
                      value: panel.enabled ? 'true' : 'false',
                      options: [
                        { value: 'true', label: 'Да' },
                        { value: 'false', label: 'Нет' },
                      ],
                    },
                  ]}
                  buildPayload={(form) => ({
                    panel_id: panel.id,
                    revision: panel.revision,
                    name: String(form.get('name') ?? ''),
                    enabled: form.get('enabled') === 'true',
                  })}
                />
                <CommandAction
                  spec={connectionCommand(
                    backend,
                    connectionId,
                    'activity-panel-rotate',
                    accountId,
                  )}
                  layout="inline"
                  disabled={sourceBlocked}
                  payload={{ panel_id: panel.id }}
                />
              </article>
            ))}
            <CommandAction
              spec={connectionCommand(backend, connectionId, 'activity-panel-create', accountId)}
              layout="inline"
              disabled={sourceBlocked}
              disabledReason={sourceBlocked ? 'Источник панелей недоступен.' : undefined}
              fields={[
                { name: 'name', label: 'Имя', required: true },
                { name: 'employee_ids', label: 'ID сотрудников через запятую', required: true },
                { name: 'from', label: 'Окно с (HH:MM)', value: '09:00', required: true },
                { name: 'to', label: 'Окно по (HH:MM)', value: '18:00', required: true },
              ]}
              buildPayload={(form) => ({
                name: String(form.get('name') ?? ''),
                employee_ids: String(form.get('employee_ids') ?? '')
                  .split(',')
                  .map((item) => Number(item.trim()))
                  .filter((item) => Number.isFinite(item)),
                display_window: { from: String(form.get('from')), to: String(form.get('to')) },
                enabled: true,
              })}
            />
          </div>
        )}
      </Observation>
      <EmployeesBlock
        backend={backend}
        employees={employees}
        dependentHint={
          employees.data && observationDependsOnIncident(employees.data, incident)
            ? dependentHint
            : undefined
        }
      />
      <Observation
        title="Правила lead-status"
        observation={asObservation(rules.data, backend)}
        onRetry={() => void rules.refetch()}
      >
        {(items) =>
          items.length === 0 ? (
            <p className={page.muted}>Нет правил</p>
          ) : (
            items.map((rule) => (
              <LeadStatusRuleForm
                key={rule.id}
                rule={rule}
                backend={backend}
                connectionId={connectionId}
                accountId={accountId}
                blocked={sourceBlocked}
                onDirtyChange={(dirty) =>
                  setDirtyRules((current) => ({ ...current, [rule.id]: dirty }))
                }
              />
            ))
          )
        }
      </Observation>
      <Observation
        title="История lead-status"
        observation={asObservation(runs.data, backend)}
        onRetry={() => void runs.refetch()}
      >
        {(pageData) =>
          pageData.items.length === 0 ? (
            <EmptyState
              title="Нет запусков"
              description="Здесь появится история после первого выполнения правила lead-status."
            />
          ) : (
            <LeadStatusRunsList items={pageData.items} />
          )
        }
      </Observation>
      <BackToTop />
    </div>
  )
}

function asObservation<T>(
  value: ObservationType<T> | undefined,
  backend: string,
): ObservationType<T> {
  return (
    value ?? {
      source: backend,
      observed_at: new Date(0).toISOString(),
      freshness: 'unknown',
    }
  )
}

function SyncCommands({
  accountId,
  backend,
  connectionId,
  status,
  blocked,
  onRetry,
  dependentHint,
}: {
  accountId: string
  backend: string
  connectionId: string
  status: ObservationType<import('../../../../api/types').ActivitySync> | undefined
  blocked: boolean
  onRetry: () => void
  dependentHint?: ReactNode
}) {
  const sync = status?.data
  const state = sync?.state
  const disabledLike = state === 'disabled' || state === 'not_enabled'
  const spec = connectionCommand(backend, connectionId, 'activity-sync', accountId)
  const reason = blocked
    ? 'Состояние синхронизации неизвестно. Сначала восстановите доступ к Core.'
    : undefined
  return (
    <section className={page.stack}>
      <Observation
        title="Синхронизация"
        observation={asObservation(status, backend)}
        onRetry={onRetry}
        dependentHint={dependentHint}
        status={sync ? <StatusBadge domain="sync" state={sync.state} raw={sync.raw} /> : undefined}
      >
        {(data) => (
          <div className={page.stack}>
            <p className={page.muted}>
              После запуска операция продолжит выполняться в фоне. Результат появится в истории.
            </p>
            <p>
              Предыдущий запуск: <StatusBadge domain="sync" state={data.state} raw={data.raw} /> ·{' '}
              <time
                dateTime={data.last_success_at ?? undefined}
                title={formatTime(data.last_success_at)}
              >
                {formatRelativeTime(data.last_success_at)}
              </time>
            </p>
            {lastSyncDurationSeconds(data) !== null ? (
              <p>
                Длительность последнего синка:{' '}
                {formatDurationSeconds(lastSyncDurationSeconds(data))}
              </p>
            ) : null}
          </div>
        )}
      </Observation>
      {blocked ? (
        <p className={page.muted}>Команды синхронизации заблокированы, пока источник недоступен.</p>
      ) : null}
      <div className={styles.toolbar}>
        {disabledLike ? (
          <CommandAction
            spec={{ ...spec, label: 'Включить синхронизацию' }}
            layout="inline"
            disabled={blocked}
            disabledReason={reason}
            payload={{ kind: 'enable' }}
          />
        ) : (
          <>
            <CommandAction
              spec={{ ...spec, label: 'Синхронизировать сейчас' }}
              layout="inline"
              disabled={blocked}
              disabledReason={reason}
              payload={{ kind: 'sync' }}
            />
            <CommandAction
              spec={{
                ...spec,
                label: 'Догрузить период',
                consequence:
                  'Будет поставлена догрузка выбранного периода. Операция идёт в фоне. Большой интервал увеличит нагрузку на amoCRM и очередь. Уже сверенные события не удаляются.',
              }}
              layout="inline"
              disabled={blocked}
              disabledReason={reason}
              fields={[
                { name: 'from', label: 'С даты', type: 'date', required: true },
                { name: 'to', label: 'По дату', type: 'date', required: true },
              ]}
              buildPayload={(form) => ({
                kind: 'backfill',
                from: unixFromDateInput(String(form.get('from') ?? ''), false),
                to: unixFromDateInput(String(form.get('to') ?? ''), true),
              })}
            />
            <CommandAction
              spec={{
                ...spec,
                label: 'Выключить синхронизацию',
                consequence:
                  'Сбор событий остановится. Новые данные Activity перестанут поступать, пока синхронизацию не включат снова. Уже сохранённые события не удаляются.',
              }}
              layout="inline"
              disabled={blocked}
              disabledReason={reason}
              payload={{ kind: 'disable' }}
            />
          </>
        )}
      </div>
    </section>
  )
}

function LeadStatusRuleForm({
  rule,
  backend,
  connectionId,
  accountId,
  blocked,
  onDirtyChange,
}: {
  rule: LeadStatusRule
  backend: string
  connectionId: string
  accountId: string
  blocked: boolean
  onDirtyChange: (dirty: boolean) => void
}) {
  const [draft, setDraft] = useState({
    source_pipeline_id: String(rule.source_pipeline_id),
    source_status_id: String(rule.source_status_id),
    target_pipeline_id: String(rule.target_pipeline_id),
    target_status_id: String(rule.target_status_id),
    enabled: rule.enabled ? 'true' : 'false',
  })
  const dirty = useMemo(
    () =>
      draft.source_pipeline_id !== String(rule.source_pipeline_id) ||
      draft.source_status_id !== String(rule.source_status_id) ||
      draft.target_pipeline_id !== String(rule.target_pipeline_id) ||
      draft.target_status_id !== String(rule.target_status_id) ||
      draft.enabled !== (rule.enabled ? 'true' : 'false'),
    [draft, rule],
  )
  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange
  useEffect(() => {
    onDirtyChangeRef.current(dirty)
    return () => onDirtyChangeRef.current(false)
  }, [dirty])
  return (
    <article className={page.card}>
      <p>
        Воронка {formatNull(rule.source_pipeline_id)}: из статуса{' '}
        {formatNull(rule.source_status_id)} → в статус {formatNull(rule.target_status_id)}
        {rule.target_pipeline_id !== rule.source_pipeline_id
          ? ` воронки ${formatNull(rule.target_pipeline_id)}`
          : ''}
      </p>
      <p>
        <strong>Обновлено</strong>{' '}
        <time dateTime={rule.updated_at} title={formatTime(rule.updated_at)}>
          {formatDateLong(rule.updated_at)}
        </time>
        {' · '}
        {formatRelativeTime(rule.updated_at)}
      </p>
      {dirty ? (
        <p className={styles.unsaved} role="status">
          Есть несохранённые изменения. Сохраните правило или уйдите с подтверждением.
        </p>
      ) : null}
      <div className={page.stack}>
        <label className={page.stack}>
          Исходная воронка
          <input
            name="source_pipeline_id"
            type="number"
            value={draft.source_pipeline_id}
            onChange={(event) => setDraft({ ...draft, source_pipeline_id: event.target.value })}
          />
        </label>
        <label className={page.stack}>
          Исходный статус
          <input
            name="source_status_id"
            type="number"
            value={draft.source_status_id}
            onChange={(event) => setDraft({ ...draft, source_status_id: event.target.value })}
          />
        </label>
        <label className={page.stack}>
          Целевая воронка
          <input
            name="target_pipeline_id"
            type="number"
            value={draft.target_pipeline_id}
            onChange={(event) => setDraft({ ...draft, target_pipeline_id: event.target.value })}
          />
        </label>
        <label className={page.stack}>
          Целевой статус
          <input
            name="target_status_id"
            type="number"
            value={draft.target_status_id}
            onChange={(event) => setDraft({ ...draft, target_status_id: event.target.value })}
          />
        </label>
        <label className={page.stack}>
          Включено
          <select
            name="enabled"
            value={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.value })}
          >
            <option value="true">Да</option>
            <option value="false">Нет</option>
          </select>
        </label>
      </div>
      <CommandAction
        spec={connectionCommand(backend, connectionId, 'lead-status-configure', accountId)}
        layout="inline"
        disabled={blocked || !dirty}
        disabledReason={
          blocked ? 'Источник недоступен.' : dirty ? undefined : 'Нет несохранённых изменений'
        }
        payload={{
          source_pipeline_id: Number(draft.source_pipeline_id),
          source_status_id: Number(draft.source_status_id),
          target_pipeline_id: Number(draft.target_pipeline_id),
          target_status_id: Number(draft.target_status_id),
          enabled: draft.enabled === 'true',
          expected_revision: rule.revision,
        }}
      />
      <TechnicalDetails>
        <p>Версия правила: {formatNull(rule.revision)}</p>
        <p>
          {formatNull(rule.source_pipeline_id)}/{formatNull(rule.source_status_id)} →{' '}
          {formatNull(rule.target_pipeline_id)}/{formatNull(rule.target_status_id)}
        </p>
      </TechnicalDetails>
    </article>
  )
}

const unsavedLeaveMessage = 'Есть несохранённые изменения правила lead-status. Уйти без сохранения?'

function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) {
      return
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = unsavedLeaveMessage
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])
}

function EmployeesBlock({
  backend,
  employees,
  dependentHint,
}: {
  backend: string
  employees: {
    isPending: boolean
    error: unknown
    data?: ObservationType<ActivityEmployee[]>
    refetch: () => Promise<unknown>
  }
  dependentHint?: ReactNode
}) {
  if (employees.isPending) {
    return (
      <div className={page.stack} role="status" aria-live="polite">
        <p className={page.muted}>Загрузка сотрудников amoCRM…</p>
        <div className={styles.listSkeleton}>
          <div className={styles.listSkeletonItem} />
          <div className={styles.listSkeletonItem} />
          <div className={styles.listSkeletonItem} />
        </div>
      </div>
    )
  }
  if (employees.error) {
    return <ErrorState error={employees.error} onRetry={() => void employees.refetch()} />
  }
  return (
    <Observation
      title="Сотрудники amoCRM"
      observation={asObservation(employees.data, backend)}
      onRetry={() => void employees.refetch()}
      dependentHint={dependentHint}
    >
      {(items) =>
        items.length === 0 ? (
          <EmptyState
            title="Нет сотрудников"
            description="В amoCRM нет сотрудников, доступных для панелей этой установки. Это не ошибка источника."
          />
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                {item.name} · {formatNull(item.id)} · {item.group_name}
              </li>
            ))}
          </ul>
        )
      }
    </Observation>
  )
}

function LeadStatusRunsList({ items }: { items: LeadStatusRun[] }) {
  return (
    <div className={page.stack}>
      {items.map((run) => (
        <article key={run.id} className={page.card}>
          <dl className={page.dl}>
            <dt>Вход</dt>
            <dd>{formatNull(run.workflow_type)}</dd>
            <dt>Статус</dt>
            <dd>
              <StatusBadge domain="job" state={run.status} raw={run.raw} />
            </dd>
            <dt>Результат</dt>
            <dd>{formatNull(run.effect_state || null)}</dd>
            <dt>Ошибка</dt>
            <dd>{formatNull(run.error_reason || null)}</dd>
            <dt>Пропуск</dt>
            <dd>{formatNull(run.skip_reason || null)}</dd>
            <dt>Создан</dt>
            <dd>{formatTime(run.created_at)}</dd>
            <dt>Завершён</dt>
            <dd>{formatTime(run.finished_at)}</dd>
          </dl>
        </article>
      ))}
    </div>
  )
}
