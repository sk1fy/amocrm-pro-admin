import { useEffect, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePushSearch, useRouteSearch } from '../../app/hooks'
import type { ConnectionSearch } from '../../app/search'
import { fetchDistribution, fetchDistributionTrace, keys } from '../../api/queries'
import { visibleInterval } from '../../api/queryClient'
import type { DistributionCount, DistributionTraceItem } from '../../api/types'
import { CopyableId } from '../../components/CopyableId'
import { DataTable } from '../../components/DataTable'
import { ErrorState } from '../../components/ErrorState'
import { Observation } from '../../components/Observation'
import { PageSkeleton } from '../../components/PageSkeleton'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull, formatTime } from '../../lib/format'
import { CommandAction } from '../operations/CommandAction'
import { connectionCommand, type CommandSpec } from '../operations/commands'
import styles from './distribution.module.css'

const kindLabels: Record<string, string> = {
  event: 'Событие',
  operation: 'Назначение',
  result: 'Результат',
  scan: 'Сверка',
  consumer: 'Получатель события',
}

export function DistributionSection({
  backend,
  connectionId,
  accountId,
}: {
  backend: string
  connectionId: string
  accountId: string
}) {
  const search = useRouteSearch<ConnectionSearch>()
  const push = usePushSearch()
  const path = `/accounts/${encodeURIComponent(accountId)}/widgets/${encodeURIComponent(backend)}/${encodeURIComponent(connectionId)}`
  const [draft, setDraft] = useState(search.reference ?? '')
  useEffect(() => {
    setDraft(search.reference ?? '')
  }, [search.reference])
  const params = {
    reference: search.reference,
    cursor: search.distribution_cursor,
    limit: search.distribution_limit ?? 25,
  }
  const summary = useQuery({
    queryKey: keys.distribution(backend, connectionId),
    queryFn: ({ signal }) => fetchDistribution(backend, connectionId, signal),
    refetchInterval: visibleInterval(15000),
  })
  const trace = useQuery({
    queryKey: keys.distributionTrace(backend, connectionId, params),
    queryFn: ({ signal }) => fetchDistributionTrace(backend, connectionId, params, signal),
    enabled: Boolean(summary.data?.data),
    refetchInterval: visibleInterval(15000),
  })
  const inspect = () => {
    void summary.refetch()
    void trace.refetch()
  }
  const setReference = (reference?: string) => {
    setDraft(reference ?? '')
    push(path, { section: 'distribution', reference, distribution_limit: params.limit })
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setReference(draft.trim() || undefined)
  }
  const spec = (command: string) => distributionCommand(backend, connectionId, command)
  const writable = summary.data?.freshness === 'fresh' && !summary.error
  return (
    <div className={`${page.stack} ${styles.container}`}>
      <p>Диагностика Core для выбранной установки. Очередь и правила TeamOS проверяйте в TeamOS.</p>
      {summary.isPending ? (
        <PageSkeleton label="Загрузка распределения…" />
      ) : summary.error ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : summary.data ? (
        <Observation title="Распределение сделок" observation={summary.data} onRetry={inspect}>
          {(data) => (
            <div className={`${page.stack} ${styles.content}`}>
              <StatusBadge domain="origin" state={data.origin} />
              <dl className={`${page.dl} ${styles.facts}`}>
                <dt>Модуль Core</dt>
                <dd>{data.module_enabled ? 'Разрешён' : 'Выключен'}</dd>
                <dt>Новые назначения</dt>
                <dd>{data.paused ? 'Приостановлены' : 'Разрешены при выполнении правил'}</dd>
                <dt>Авторизация</dt>
                <dd>
                  <StatusBadge
                    domain="authorization"
                    state={data.authorization_state}
                    raw={data.authorization_raw}
                  />
                </dd>
                <dt>Webhook</dt>
                <dd>
                  <StatusBadge domain="webhook" state={data.webhook_state} raw={data.webhook_raw} />{' '}
                  · {formatTime(data.webhook_checked_at)}
                </dd>
                <dt>Связь TeamOS</dt>
                <dd>
                  {data.binding ? (
                    <>
                      <StatusBadge
                        domain="distribution"
                        state={data.binding.state}
                        raw={data.binding.raw}
                      />{' '}
                      <CopyableId value={data.binding.id} label="ID связи" /> · компания{' '}
                      <CopyableId value={data.binding.company_id} label="ID компании" />
                    </>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt>Версии связи / сотрудников</dt>
                <dd>
                  {data.binding
                    ? `${data.binding.revision} / ${data.binding.mapping_revision}`
                    : '—'}
                </dd>
                <dt>Сопоставленные сотрудники</dt>
                <dd>{formatNull(data.binding?.mapped_employees)}</dd>
                <dt>Разрешение Core для TeamOS</dt>
                <dd>
                  {data.binding
                    ? data.binding.service_authorized
                      ? 'Разрешён'
                      : 'Не разрешён'
                    : '—'}
                </dd>
                <dt>Очередь TeamOS</dt>
                <dd>
                  <StatusBadge domain="distribution" state={data.team_queue_state} /> — источник
                  Core её не наблюдает
                </dd>
                <dt>Пробелы исторической сверки</dt>
                <dd>{data.historical_gaps}</dd>
              </dl>
              <div className={styles.backlogs}>
                <section>
                  <h4>Доставка событий</h4>
                  <Counts items={data.events.states} />
                  <p>Самое старое ожидание: {formatTime(data.events.oldest_pending_at)}</p>
                </section>
                <section>
                  <h4>Доставка результатов</h4>
                  <Counts items={data.results.states} />
                  <p>Самое старое ожидание: {formatTime(data.results.oldest_pending_at)}</p>
                </section>
                <section>
                  <h4>Назначения Core</h4>
                  <Counts items={data.operations} />
                </section>
              </div>
              <div className={page.row}>
                <CommandAction
                  spec={connectionCommand(backend, connectionId, 'check')}
                  onInspect={inspect}
                />
                <CommandAction
                  spec={connectionCommand(backend, connectionId, 'reconcile')}
                  onInspect={inspect}
                />
                <CommandAction
                  spec={spec(data.paused ? 'distribution-resume' : 'distribution-pause')}
                  payload={{ expected_paused: data.paused }}
                  disabled={!writable}
                  disabledReason={!writable ? 'Нужно свежее состояние источника' : undefined}
                  onInspect={inspect}
                />
              </div>
            </div>
          )}
        </Observation>
      ) : null}
      <form onSubmit={submit} className={styles.search}>
        <label htmlFor="distribution-reference">ID события, операции или запроса</label>
        <input
          id="distribution-reference"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="UUID"
        />
        <button type="submit">Найти цепочку</button>
        <button type="button" onClick={() => setReference()}>
          Сбросить поиск
        </button>
        <label>
          Строк на странице
          <select
            value={params.limit}
            onChange={(event) =>
              push(path, {
                section: 'distribution',
                reference: search.reference,
                distribution_limit: Number(event.target.value),
              })
            }
          >
            <option value={1}>1</option>
            <option value={25}>25</option>
            <option value={100}>100</option>
          </select>
        </label>
      </form>
      {summary.data?.data && !summary.error && trace.error ? (
        <ErrorState error={trace.error} onRetry={() => void trace.refetch()} />
      ) : trace.isPending && summary.data?.data && !summary.error ? (
        <PageSkeleton label="Загрузка цепочки…" />
      ) : trace.data && summary.data?.data && !summary.error ? (
        <Observation
          title="Событие → доставка → назначение → результат"
          observation={trace.data}
          onRetry={() => void trace.refetch()}
        >
          {(data) => (
            <div className={`${page.stack} ${styles.content}`}>
              {data.items.length === 0 ? (
                <p>В этой установке связанных записей не найдено.</p>
              ) : (
                <DataTable
                  rows={data.items}
                  rowKey={(row) => `${row.kind}:${row.id}`}
                  columns={[
                    {
                      id: 'kind',
                      header: 'Шаг',
                      cell: (row) => (
                        <>
                          {kindLabels[row.kind] ?? 'Неизвестный шаг'}
                          <CopyableId value={row.id} label="ID шага" />
                        </>
                      ),
                    },
                    {
                      id: 'state',
                      header: 'Состояние',
                      cell: (row) => (
                        <StatusBadge domain="distribution" state={row.state} raw={row.raw} />
                      ),
                    },
                    { id: 'time', header: 'Время', cell: (row) => formatTime(row.created_at) },
                    {
                      id: 'details',
                      header: 'Связи и результат',
                      cell: (row) => <TraceDetails row={row} onSearch={setReference} />,
                    },
                    {
                      id: 'actions',
                      header: 'Восстановление',
                      cell: (row) => (
                        <TraceActions
                          row={row}
                          spec={spec}
                          onInspect={inspect}
                          disabled={
                            !writable || Boolean(trace.error) || trace.data?.freshness !== 'fresh'
                          }
                        />
                      ),
                    },
                  ]}
                />
              )}
              <div className={page.row}>
                {search.distribution_cursor ? (
                  <button
                    type="button"
                    onClick={() =>
                      push(path, {
                        section: 'distribution',
                        reference: search.reference,
                        distribution_limit: params.limit,
                      })
                    }
                  >
                    Первая страница
                  </button>
                ) : null}
                {data.next_cursor ? (
                  <button
                    type="button"
                    onClick={() =>
                      push(path, {
                        section: 'distribution',
                        reference: search.reference,
                        distribution_limit: params.limit,
                        distribution_cursor: data.next_cursor ?? undefined,
                      })
                    }
                  >
                    Следующая страница
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </Observation>
      ) : null}
      <p className={page.muted}>
        Принятая команда (202) и завершённая диагностика не означают успешное назначение.
        Подтверждение смотрите в состоянии операции и фактах результата.
      </p>
    </div>
  )
}

function Counts({ items }: { items: DistributionCount[] }) {
  return items.length ? (
    <ul>
      {items.map((item) => (
        <li key={`${item.state}:${item.raw ?? ''}`}>
          <StatusBadge domain="distribution" state={item.state} raw={item.raw} /> — {item.count}
        </li>
      ))}
    </ul>
  ) : (
    <p>Источник подтвердил отсутствие записей.</p>
  )
}
function TraceDetails({
  row,
  onSearch,
}: {
  row: DistributionTraceItem
  onSearch: (reference: string) => void
}) {
  return (
    <details>
      <summary>Подробнее</summary>
      <dl className={styles.details}>
        <dt>Сделка</dt>
        <dd>{formatNull(row.lead_id)}</dd>
        <dt>Эффект в CRM</dt>
        <dd>
          {row.external_effect_state ? (
            <StatusBadge domain="distribution_effect" state={row.external_effect_state} />
          ) : (
            '—'
          )}
        </dd>
        <dt>Основание / ошибка</dt>
        <dd>
          {formatNull(row.evidence)} / {formatNull(row.error_code)}
        </dd>
        <dt>Версия результата / попытки</dt>
        <dd>
          {formatNull(row.result_version)} / {formatNull(row.attempts)}
        </dd>
        {Object.entries({
          Событие: row.event_id,
          Операция: row.operation_id,
          Корреляция: row.correlation_id,
          Причина: row.causation_id,
        }).map(([label, id]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {id ? (
                <>
                  <CopyableId value={id} label={label} />
                  <button type="button" onClick={() => onSearch(id)}>
                    Показать связи
                  </button>
                </>
              ) : (
                '—'
              )}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
function TraceActions({
  row,
  spec,
  onInspect,
  disabled,
}: {
  row: DistributionTraceItem
  spec: (command: string) => CommandSpec
  onInspect: () => void
  disabled: boolean
}) {
  if (row.kind === 'operation' && row.result_version !== null && row.state === 'outcome_unknown')
    return (
      <CommandAction
        spec={spec('distribution-reconcile')}
        intentScope={row.id}
        payload={{ operation_id: row.id, expected_result_version: row.result_version }}
        disabled={disabled}
        onInspect={onInspect}
      />
    )
  if (
    (row.kind === 'event' || row.kind === 'result') &&
    row.state === 'blocked' &&
    row.message_id !== null &&
    row.attempts !== null
  )
    return (
      <CommandAction
        spec={spec('distribution-delivery-retry')}
        intentScope={row.message_id}
        payload={{
          kind: row.kind === 'event' ? 'events' : 'results',
          message_id: row.message_id,
          expected_attempts: row.attempts,
        }}
        disabled={disabled}
        onInspect={onInspect}
      />
    )
  return <span>—</span>
}
export function distributionCommand(backend: string, id: string, command: string): CommandSpec {
  const pause = command === 'distribution-pause' || command === 'distribution-resume'
  const labels: Record<string, string> = {
    'distribution-pause': 'Приостановить новые назначения',
    'distribution-resume': 'Возобновить новые назначения',
    'distribution-reconcile': 'Проверить результат назначения',
    'distribution-delivery-retry': 'Повторить доставку',
  }
  return {
    path: `/api/v1/connections/${encodeURIComponent(backend)}/${encodeURIComponent(id)}/commands/${command}`,
    backend,
    targetType: 'installation',
    targetId: id,
    command,
    label: labels[command],
    permission: pause ? 'connections:disable' : 'operations:retry',
    object: `Установка ${id} · ${backend}`,
    scope: pause
      ? 'Новые CRM-команды этой установки. Правила TeamOS и принятые операции сохраняются.'
      : 'Только выбранная операция или замороженное сообщение этой установки.',
    consequence:
      command === 'distribution-reconcile'
        ? 'Повторная проверка читает CRM. Новое назначение не отправляется; неизвестный эффект сохраняет защиту.'
        : command === 'distribution-delivery-retry'
          ? 'Повторяет тот же неизменный конверт, если число попыток и состояние ещё соответствуют показанным.'
          : 'Текущие операции и неизвестные результаты продолжают проверяться. Пауза обратима.',
    nextStep: 'После операции обновите диагностику и проверьте подтверждённый результат.',
  }
}
