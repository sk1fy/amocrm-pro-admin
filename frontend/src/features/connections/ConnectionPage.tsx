import { Link } from '@tanstack/react-router'
import { useRouteParams } from '../../app/hooks'
import { useQuery } from '@tanstack/react-query'
import { fetchBackends, fetchConnection, keys } from '../../api/queries'
import { ErrorState } from '../../components/ErrorState'
import { Observation } from '../../components/Observation'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { parseActivity } from '../../lib/activity'
import { formatNull, formatTime } from '../../lib/format'
import { exploreURL } from '../../lib/observability'
import { CommandAction } from '../operations/CommandAction'
import { connectionCommand } from '../operations/commands'
import { RetryDelivery } from '../operations/RetryActions'

export function ConnectionPage() {
  const { accountId, backend, connectionId } = useRouteParams<{
    accountId: string
    backend: string
    connectionId: string
  }>()
  const query = useQuery({
    queryKey: keys.connection(backend, connectionId),
    queryFn: () => fetchConnection(backend, connectionId),
  })
  const backends = useQuery({ queryKey: keys.backends, queryFn: fetchBackends })

  if (query.isPending) {
    return <div className={page.skeleton} />
  }
  if (query.error) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  }
  const card = query.data
  if (!card) {
    return null
  }
  const identity = card.connection.data

  return (
    <div className={page.page}>
      <p>
        <Link to="/accounts/$accountId" params={{ accountId }}>
          Назад к аккаунту {accountId}
        </Link>
      </p>
      <h2>Подключение {identity?.integration_code ?? connectionId}</h2>
      <div className={page.row}>
        {[
          'check',
          'enable',
          'disable',
          'revoke',
          'uninstall',
          'reconcile',
          'pilot-enable',
          'pilot-disable',
        ].map((command) => (
          <CommandAction
            key={command}
            spec={connectionCommand(backend, connectionId, command, accountId)}
            disabled={
              !identity ||
              (command === 'enable' && identity.state !== 'disabled') ||
              (command === 'revoke' && ['disabled', 'uninstalled'].includes(identity.state))
            }
            onInspect={() => void query.refetch()}
          />
        ))}
      </div>
      <div className={page.row}>
        <Link
          to="/accounts/$accountId/widgets/$backend/$connectionId/settings"
          params={{ accountId, backend, connectionId }}
        >
          Настройки Activity и lead-status
        </Link>
        <Link
          to="/operations/admin"
          search={{ backend, target_type: 'installation', target_id: connectionId }}
        >
          История команд этого подключения
        </Link>
      </div>
      <Observation
        title="Идентификация"
        observation={card.connection}
        onRetry={() => void query.refetch()}
      >
        {(conn) => (
          <dl className={page.dl}>
            <dt>Интеграция</dt>
            <dd>{conn.integration_code}</dd>
            <dt>ID установки</dt>
            <dd>{conn.id}</dd>
            <dt>ID аккаунта</dt>
            <dd>{conn.account_id}</dd>
            <dt>Домен</dt>
            <dd>{formatNull(conn.account_domain)}</dd>
            <dt>Кем установлено</dt>
            <dd>{formatNull(conn.installed_by ?? null)}</dd>
            <dt>Создано</dt>
            <dd>{formatTime(conn.created_at)}</dd>
            <dt>Обновлено</dt>
            <dd>{formatTime(conn.updated_at)}</dd>
            <dt>Происхождение</dt>
            <dd>
              <StatusBadge domain="origin" state={conn.origin} />
            </dd>
            <dt>Состояние</dt>
            <dd>
              <StatusBadge domain="connection" state={conn.state} raw={conn.raw} />
            </dd>
          </dl>
        )}
      </Observation>
      <Observation
        title="Авторизация"
        observation={card.authorization}
        onRetry={() => void query.refetch()}
      >
        {(auth) => (
          <div className={page.stack}>
            <div className={page.row}>
              <StatusBadge domain="authorization" state={auth.state} raw={auth.raw} />
              {auth.unverified ? (
                <span className={page.muted}>не проверено запросом к amoCRM</span>
              ) : null}
            </div>
            <p>Учётные данные: {auth.credentials_present ? 'есть' : 'нет'}</p>
            <p>Действует до: {formatTime(auth.expires_at)}</p>
            <p>Версия учётных данных: {formatNull(auth.credential_version ?? null)}</p>
            <p>Версия ключа: {formatNull(auth.key_version ?? null)}</p>
          </div>
        )}
      </Observation>
      {card.authorization_check ? (
        <Observation
          title="Последняя проверка amoCRM"
          observation={card.authorization_check}
          onRetry={() => void query.refetch()}
        >
          {(check) => (
            <div className={page.stack}>
              <StatusBadge domain="verification" state={check.classification} />
              <time dateTime={check.observed_at}>{formatTime(check.observed_at)}</time>
              {check.retry_after !== undefined ? (
                <p>Повторная проверка через {check.retry_after} с.</p>
              ) : null}
            </div>
          )}
        </Observation>
      ) : null}
      <Observation title="Webhook" observation={card.webhook} onRetry={() => void query.refetch()}>
        {(hook) => (
          <div className={page.stack}>
            <StatusBadge domain="webhook" state={hook.status} raw={hook.raw} />
            <p>События: {hook.events.length > 0 ? hook.events.join(', ') : formatNull(null)}</p>
            <p>Проверено: {formatTime(hook.checked_at)}</p>
            <p>Последняя ошибка: {formatNull(hook.last_error)}</p>
            <p>Подтверждённых destinations: {formatNull(hook.confirmed_destinations)}</p>
          </div>
        )}
      </Observation>
      <Observation
        title="Гранты сервисов"
        observation={card.grants}
        onRetry={() => void query.refetch()}
      >
        {(grants) =>
          grants.length === 0 ? (
            <p className={page.muted}>Нет грантов</p>
          ) : (
            <ul>
              {grants.map((grant) => (
                <li key={grant.service}>
                  {grant.service}:{' '}
                  <StatusBadge domain="grant" state={grant.state} raw={grant.raw} />
                </li>
              ))}
            </ul>
          )
        }
      </Observation>
      <Observation
        title="Activity"
        observation={card.activity}
        onRetry={() => void query.refetch()}
      >
        {(raw) => {
          const activity = parseActivity(raw)
          return (
            <div className={page.stack}>
              <div>
                Пилот: <StatusBadge domain="pilot" state={activity.pilot || 'not_configured'} />
              </div>
              {activity.deliveries.length === 0 ? (
                <p className={page.muted}>Нет команд доставки</p>
              ) : (
                <ul>
                  {activity.deliveries.map((item) => (
                    <li key={item.command_id}>
                      {item.action} → {item.target}{' '}
                      <StatusBadge domain="delivery" state={item.status} raw={item.raw} /> попыток{' '}
                      {formatNull(item.attempts)}/{formatNull(item.max_attempts)}
                      <RetryDelivery
                        backend={backend}
                        connectionId={connectionId}
                        delivery={item}
                        onInspect={() => void query.refetch()}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        }}
      </Observation>
      <Observation
        title="Синхронизация Activity"
        observation={card.activity_sync}
        onRetry={() => void query.refetch()}
      >
        {(sync) => (
          <div className={page.stack}>
            <StatusBadge domain="sync" state={sync.state} raw={sync.raw} />
            <p className={page.muted}>
              «Нет данных», устаревшие данные и «синхронизация не включена» — не то же самое, что
              нулевая активность.
            </p>
            <p>Задержка, сек: {formatNull(sync.lag_seconds ?? null)}</p>
            <p>Последний успех: {formatTime(sync.last_success_at)}</p>
            <p>Последнее событие: {formatTime(sync.last_event_at)}</p>
            <p>
              Проверенный диапазон: {formatTime(sync.verified_from)} — {formatTime(sync.verified_through)}
            </p>
            <p>Ошибка: {formatNull(sync.error_code || null)}</p>
            {sync.reauth_required ? <p>Требуется повторная авторизация клиента.</p> : null}
            <ObservabilityLinks
              grafana={backends.data?.observability?.grafana_base_url}
              loki={backends.data?.observability?.loki_base_url}
              accountId={identity?.account_id ?? accountId}
              installationId={connectionId}
            />
          </div>
        )}
      </Observation>
      <Observation
        title="Последние задачи"
        observation={card.recent_jobs}
        onRetry={() => void query.refetch()}
      >
        {(jobs) =>
          jobs.length === 0 ? (
            <p className={page.muted}>Нет задач</p>
          ) : (
            <ul>
              {jobs.map((job) => (
                <li key={job.id}>
                  {job.type} <StatusBadge domain="job" state={job.status} raw={job.raw} />{' '}
                  {formatTime(job.updated_at)}
                  {job.last_error_message ? ` — ${job.last_error_message}` : ''}
                </li>
              ))}
            </ul>
          )
        }
      </Observation>
      <Observation
        title="История"
        observation={card.recent_audit}
        onRetry={() => void query.refetch()}
      >
        {(items) =>
          items.length === 0 ? (
            <p className={page.muted}>Нет записей аудита</p>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  {formatTime(item.created_at)} · {item.action} · {item.actor_type}
                </li>
              ))}
            </ul>
          )
        }
      </Observation>
    </div>
  )
}

function ObservabilityLinks({
  grafana,
  loki,
  accountId,
  installationId,
}: {
  grafana?: string
  loki?: string
  accountId: string
  installationId: string
}) {
  const query = `account_id=${accountId} installation_id=${installationId}`
  const grafanaURL = exploreURL(grafana, 'now-24h', 'now', query)
  const lokiURL = exploreURL(loki, 'now-24h', 'now', query)
  if (!grafanaURL && !lokiURL) return null
  return (
    <p className={page.row}>
      {grafanaURL ? (
        <a href={grafanaURL} rel="noreferrer">
          Grafana
        </a>
      ) : null}
      {lokiURL ? (
        <a href={lokiURL} rel="noreferrer">
          Loki
        </a>
      ) : null}
    </p>
  )
}
