import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useRouteParams } from '../../app/hooks'
import {
  fetchActivityEmployees,
  fetchActivityPanels,
  fetchActivitySettings,
  fetchLeadStatusRules,
  fetchLeadStatusRuns,
  keys,
} from '../../api/queries'
import { ErrorState } from '../../components/ErrorState'
import { Observation } from '../../components/Observation'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull, formatTime } from '../../lib/format'
import { unixFromDateInput, unixFromRFC3339 } from '../../lib/observability'
import { CommandAction } from '../operations/CommandAction'
import { connectionCommand } from '../operations/commands'

export function SettingsPage() {
  const { accountId, backend, connectionId } = useRouteParams<{
    accountId: string
    backend: string
    connectionId: string
  }>()
  const settings = useQuery({
    queryKey: keys.activitySettings(backend, connectionId),
    queryFn: () => fetchActivitySettings(backend, connectionId),
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

  return (
    <div className={page.page}>
      <p>
        <Link
          to="/accounts/$accountId/widgets/$backend/$connectionId"
          params={{ accountId, backend, connectionId }}
        >
          Назад к подключению
        </Link>
      </p>
      <h2>Настройки Activity и lead-status</h2>
      {settings.isPending || panels.isPending ? <div className={page.skeleton} /> : null}
      {settings.error ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : null}
      <Observation
        title="Настройки Activity"
        observation={
          settings.data ?? {
            source: backend,
            observed_at: new Date(0).toISOString(),
            freshness: 'unknown',
          }
        }
        onRetry={() => void settings.refetch()}
      >
        {(data) => (
          <div className={page.stack}>
            <p>
              Текущие значения: initial_days={formatNull(data.initial_days)}, retention_days=
              {formatNull(data.retention_days)}
            </p>
            <CommandAction
              spec={connectionCommand(backend, connectionId, 'activity-configure', accountId)}
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
      <section className={page.stack}>
        <h3>Синхронизация</h3>
        <p className={page.muted}>Ответ 202 не означает завершение. Дождитесь результата операции.</p>
        {(['enable', 'sync', 'disable'] as const).map((kind) => (
          <CommandAction
            key={kind}
            spec={{
              ...connectionCommand(backend, connectionId, 'activity-sync', accountId),
              label:
                kind === 'enable'
                  ? 'Включить синхронизацию'
                  : kind === 'disable'
                    ? 'Выключить синхронизацию'
                    : 'Синхронизировать сейчас',
            }}
            payload={{ kind }}
          />
        ))}
        <CommandAction
          spec={{
            ...connectionCommand(backend, connectionId, 'activity-sync', accountId),
            label: 'Догрузить период',
          }}
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
      </section>
      <Observation
        title="Панели"
        observation={
          panels.data ?? {
            source: backend,
            observed_at: new Date(0).toISOString(),
            freshness: 'unknown',
          }
        }
        onRetry={() => void panels.refetch()}
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
                <p>Revision: {formatNull(panel.revision)}</p>
                <StatusBadge domain="grant" state={panel.enabled ? 'granted' : 'not_granted'} />
                <CommandAction
                  spec={connectionCommand(backend, connectionId, 'activity-panel-patch', accountId)}
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
                  spec={connectionCommand(backend, connectionId, 'activity-panel-rotate', accountId)}
                  payload={{ panel_id: panel.id }}
                />
              </article>
            ))}
            <CommandAction
              spec={connectionCommand(backend, connectionId, 'activity-panel-create', accountId)}
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
      <Observation
        title="Сотрудники amoCRM"
        observation={
          employees.data ?? {
            source: backend,
            observed_at: new Date(0).toISOString(),
            freshness: 'unknown',
          }
        }
      >
        {(items) =>
          items.length === 0 ? (
            <p className={page.muted}>Нет сотрудников</p>
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
      <Observation
        title="Правила lead-status"
        observation={
          rules.data ?? {
            source: backend,
            observed_at: new Date(0).toISOString(),
            freshness: 'unknown',
          }
        }
        onRetry={() => void rules.refetch()}
      >
        {(items) =>
          items.length === 0 ? (
            <p className={page.muted}>Нет правил</p>
          ) : (
            items.map((rule) => (
              <article key={rule.id} className={page.card}>
                <p>
                  {formatNull(rule.source_pipeline_id)}/{formatNull(rule.source_status_id)} →{' '}
                  {formatNull(rule.target_pipeline_id)}/{formatNull(rule.target_status_id)}
                </p>
                <p>Revision: {formatNull(rule.revision)}</p>
                <CommandAction
                  spec={connectionCommand(backend, connectionId, 'lead-status-configure', accountId)}
                  fields={[
                    {
                      name: 'source_pipeline_id',
                      label: 'Исходный pipeline',
                      type: 'number',
                      value: String(rule.source_pipeline_id),
                      required: true,
                    },
                    {
                      name: 'source_status_id',
                      label: 'Исходный статус',
                      type: 'number',
                      value: String(rule.source_status_id),
                      required: true,
                    },
                    {
                      name: 'target_pipeline_id',
                      label: 'Целевой pipeline',
                      type: 'number',
                      value: String(rule.target_pipeline_id),
                      required: true,
                    },
                    {
                      name: 'target_status_id',
                      label: 'Целевой статус',
                      type: 'number',
                      value: String(rule.target_status_id),
                      required: true,
                    },
                    {
                      name: 'enabled',
                      label: 'Включено',
                      type: 'select',
                      value: rule.enabled ? 'true' : 'false',
                      options: [
                        { value: 'true', label: 'Да' },
                        { value: 'false', label: 'Нет' },
                      ],
                    },
                  ]}
                  buildPayload={(form) => ({
                    source_pipeline_id: Number(form.get('source_pipeline_id')),
                    source_status_id: Number(form.get('source_status_id')),
                    target_pipeline_id: Number(form.get('target_pipeline_id')),
                    target_status_id: Number(form.get('target_status_id')),
                    enabled: form.get('enabled') === 'true',
                    expected_revision: rule.revision,
                  })}
                />
              </article>
            ))
          )
        }
      </Observation>
      <Observation
        title="История lead-status"
        observation={
          runs.data ?? {
            source: backend,
            observed_at: new Date(0).toISOString(),
            freshness: 'unknown',
          }
        }
        onRetry={() => void runs.refetch()}
      >
        {(pageData) =>
          pageData.items.length === 0 ? (
            <p className={page.muted}>Нет запусков</p>
          ) : (
            <ul>
              {pageData.items.map((run) => (
                <li key={run.id}>
                  <StatusBadge domain="job" state={run.status} raw={run.raw} /> {run.workflow_type}{' '}
                  {formatTime(run.created_at)}
                  {run.skip_reason ? ` · пропуск: ${run.skip_reason}` : ''}
                  {run.error_reason ? ` · ошибка: ${run.error_reason}` : ''}
                </li>
              ))}
            </ul>
          )
        }
      </Observation>
    </div>
  )
}
