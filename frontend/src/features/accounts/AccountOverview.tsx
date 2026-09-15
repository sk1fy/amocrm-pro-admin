import { Link } from '@tanstack/react-router'
import { useRouteParams } from '../../app/hooks'
import { useQuery } from '@tanstack/react-query'
import { fetchAccount, keys } from '../../api/queries'
import { EmptyState } from '../../components/EmptyState'
import { Observation } from '../../components/Observation'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull } from '../../lib/format'
import { allSourcesUnavailable } from '../../components/SourcesBanner'
import { AccountSubscription } from './AccountSubscription'

export function AccountOverview() {
  const { accountId } = useRouteParams<{ accountId: string }>()
  const account = useQuery({
    queryKey: keys.account(accountId),
    queryFn: () => fetchAccount(accountId),
  })
  if (!account.data) {
    return null
  }
  return (
    <div className={page.page}>
      <AccountSubscription accountId={accountId} />
      {account.data.connections.length === 0 ? (
        allSourcesUnavailable(account.data.sources) ? (
          <EmptyState
            title="Источник недоступен"
            description="Подключения нельзя показать, пока бекенд не ответит."
          />
        ) : (
          <EmptyState title="Нет подключений" />
        )
      ) : (
        <div className={page.cards}>
          {account.data.connections.map((obs) => (
            <Observation
              key={`${obs.source}:${obs.data?.connection_id ?? obs.observed_at}`}
              observation={obs}
            >
              {(conn) => (
                <Link
                  className={page.stack}
                  to="/accounts/$accountId/widgets/$backend/$connectionId"
                  params={{
                    accountId,
                    backend: conn.backend,
                    connectionId: conn.connection_id,
                  }}
                >
                  <h2>{conn.integration_code}</h2>
                  <StatusBadge
                    domain="connection"
                    state={conn.state}
                    raw={conn.raw}
                    testId="connection-badge"
                  />
                  <div>
                    Авторизация:{' '}
                    <StatusBadge domain="authorization" state={conn.authorization?.state} />
                    {conn.authorization?.unverified ? ' (не проверено запросом к amoCRM)' : ''}
                  </div>
                  <div>
                    Webhook: <StatusBadge domain="webhook" state={conn.webhook?.status} />
                  </div>
                  {conn.webhook?.last_error ? <p>{conn.webhook.last_error}</p> : null}
                  {obs.freshness === 'stale' || obs.freshness === 'unavailable' ? (
                    <p className={page.muted}>
                      Данные этого подключения{' '}
                      {obs.freshness === 'stale' ? 'устарели' : 'недоступны'}. Это не состояние «всё
                      в порядке».
                    </p>
                  ) : null}
                  <p className={page.muted}>{conn.account_domain || formatNull(null)}</p>
                </Link>
              )}
            </Observation>
          ))}
        </div>
      )}
    </div>
  )
}
