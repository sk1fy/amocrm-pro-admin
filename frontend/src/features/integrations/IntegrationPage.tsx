import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useRouteParams } from '../../app/hooks'
import { fetchIntegration, keys } from '../../api/queries'
import { ErrorState } from '../../components/ErrorState'
import { Observation } from '../../components/Observation'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull, formatTime, hostFromRedirect } from '../../lib/format'

export function IntegrationPage() {
  const { backend, integrationId } = useRouteParams<{ backend: string; integrationId: string }>()
  const query = useQuery({
    queryKey: keys.integration(backend, integrationId),
    queryFn: () => fetchIntegration(backend, integrationId),
  })
  if (query.isPending) {
    return <div className={page.skeleton} />
  }
  if (query.error) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  }
  if (!query.data) {
    return null
  }
  return (
    <div className={page.page}>
      <p>
        <Link to="/widgets">Виджеты</Link>
      </p>
      <Observation title="Интеграция" observation={query.data} onRetry={() => void query.refetch()}>
        {(item) => (
          <div className={page.stack}>
            <h1>{item.code}</h1>
            <StatusBadge domain="integration" state={item.state} raw={item.raw} />
            <dl className={page.dl}>
              <dt>Бекенд</dt>
              <dd>{item.backend}</dd>
              <dt>client_id</dt>
              <dd>{item.client_id}</dd>
              <dt>Redirect host</dt>
              <dd>{hostFromRedirect(item.redirect_uri)}</dd>
              <dt>key_version</dt>
              <dd>{formatNull(item.key_version)}</dd>
              <dt>Обновлено</dt>
              <dd>{formatTime(item.updated_at)}</dd>
              <dt>События webhook</dt>
              <dd>
                {item.webhook_events.length > 0 ? item.webhook_events.join(', ') : formatNull(null)}
              </dd>
            </dl>
            <h2>Сервисы</h2>
            <ul>
              {item.grants.map((grant) => (
                <li key={grant.service}>
                  {grant.service}:{' '}
                  <StatusBadge domain="grant" state={grant.state} raw={grant.raw} />
                </li>
              ))}
            </ul>
            <h2>Подключения по состояниям</h2>
            <ul>
              {Object.entries(item.installations_by_status).map(([status, count]) => (
                <li key={status}>
                  <StatusBadge domain="connection" state={status} /> {formatNull(count)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Observation>
    </div>
  )
}
