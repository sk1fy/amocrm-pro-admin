import { Link } from '@tanstack/react-router'
import { useRouteParams } from '../../app/hooks'
import { useQuery } from '@tanstack/react-query'
import { fetchConnection, keys } from '../../api/queries'
import { ErrorState } from '../../components/ErrorState'
import { Observation } from '../../components/Observation'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { parseActivity } from '../../lib/activity'
import { formatNull, formatTime } from '../../lib/format'

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
      <Observation
        title="Идентификация"
        observation={card.connection}
        onRetry={() => void query.refetch()}
      >
        {(conn) => (
          <dl className={page.dl}>
            <dt>Интеграция</dt>
            <dd>{conn.integration_code}</dd>
            <dt>installation_id</dt>
            <dd>{conn.id}</dd>
            <dt>account_id</dt>
            <dd>{conn.account_id}</dd>
            <dt>Домен</dt>
            <dd>{formatNull(conn.account_domain)}</dd>
            <dt>installed_by</dt>
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
            <p>Версия credentials: {formatNull(auth.credential_version ?? null)}</p>
            <p>key_version: {formatNull(auth.key_version ?? null)}</p>
          </div>
        )}
      </Observation>
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
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        }}
      </Observation>
      <Observation title="Синхронизация Activity" observation={card.activity_sync} />
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
