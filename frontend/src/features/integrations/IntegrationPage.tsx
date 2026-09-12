import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useRouteParams } from '../../app/hooks'
import { fetchAccounts, fetchIntegration, keys } from '../../api/queries'
import { DataTable } from '../../components/DataTable'
import { ErrorState } from '../../components/ErrorState'
import { Observation } from '../../components/Observation'
import { SourcesBanner } from '../../components/SourcesBanner'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull, formatTime, hostFromRedirect } from '../../lib/format'

export function IntegrationPage() {
  const { backend, integrationId } = useRouteParams<{ backend: string; integrationId: string }>()
  const query = useQuery({
    queryKey: keys.integration(backend, integrationId),
    queryFn: () => fetchIntegration(backend, integrationId),
  })
  const code = query.data?.data?.code ?? ''
  const accounts = useQuery({
    queryKey: keys.accounts({ product: code, limit: 100 }),
    queryFn: () => fetchAccounts({ product: code, limit: 100 }),
    enabled: code !== '',
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
        {(item) => {
          const connections = (accounts.data?.items ?? []).flatMap((account) =>
            account.connections
              .filter(
                (connection) =>
                  connection.integration_code === item.code ||
                  connection.integration_id === item.id,
              )
              .map((connection) => ({ accountId: account.account_id, connection })),
          )
          return (
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
                  {item.webhook_events.length > 0
                    ? item.webhook_events.join(', ')
                    : formatNull(null)}
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
              <h2>Подключения</h2>
              <SourcesBanner sources={accounts.data?.sources} />
              {accounts.isPending ? <div className={page.skeleton} /> : null}
              {accounts.error ? (
                <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
              ) : null}
              {!accounts.isPending && !accounts.error && connections.length === 0 ? (
                <p className={page.muted}>Нет подключений</p>
              ) : null}
              {connections.length > 0 ? (
                <DataTable
                  rows={connections}
                  rowKey={(row) => `${row.connection.backend}:${row.connection.connection_id}`}
                  columns={[
                    {
                      id: 'account',
                      header: 'Аккаунт',
                      cell: (row) => (
                        <Link to="/accounts/$accountId" params={{ accountId: row.accountId }}>
                          {row.accountId}
                        </Link>
                      ),
                    },
                    {
                      id: 'backend',
                      header: 'Бекенд',
                      cell: (row) => row.connection.backend,
                    },
                    {
                      id: 'connection',
                      header: 'Подключение',
                      cell: (row) => row.connection.connection_id,
                    },
                    {
                      id: 'state',
                      header: 'Состояние',
                      cell: (row) => (
                        <StatusBadge
                          domain="connection"
                          state={row.connection.state}
                          raw={row.connection.raw}
                        />
                      ),
                    },
                    {
                      id: 'card',
                      header: 'Карточка',
                      cell: (row) => (
                        <Link
                          to="/accounts/$accountId/widgets/$backend/$connectionId"
                          params={{
                            accountId: row.accountId,
                            backend: row.connection.backend,
                            connectionId: row.connection.connection_id,
                          }}
                        >
                          открыть
                        </Link>
                      ),
                    },
                  ]}
                />
              ) : null}
            </div>
          )
        }}
      </Observation>
    </div>
  )
}
