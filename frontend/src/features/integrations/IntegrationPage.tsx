import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useRouteParams } from '../../app/hooks'
import { fetchAccounts, fetchIntegration, keys } from '../../api/queries'
import { CopyableId } from '../../components/CopyableId'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Observation } from '../../components/Observation'
import { PageSkeleton } from '../../components/PageSkeleton'
import { SourcesBanner } from '../../components/SourcesBanner'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull, formatRelativeTime, formatTime, hostFromRedirect } from '../../lib/format'
import { IntegrationCommands } from './IntegrationCommands'
import { WebhookEvents } from './WebhookEvents'

export function IntegrationPage() {
  const { backend, integrationId } = useRouteParams<{ backend: string; integrationId: string }>()
  const query = useQuery({
    queryKey: keys.integration(backend, integrationId),
    queryFn: () => fetchIntegration(backend, integrationId),
  })
  const accountParams = { integration_id: integrationId, backend, limit: 100 }
  const accounts = useQuery({
    queryKey: keys.accounts(accountParams),
    queryFn: () => fetchAccounts(accountParams),
    enabled: query.data?.data != null,
  })
  if (query.isPending) {
    return <PageSkeleton label="Загрузка интеграции…" variant="detail" />
  }
  if (query.error) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  }
  if (!query.data) {
    return null
  }
  return (
    <div className={page.page}>
      <Observation title="Интеграция" observation={query.data} onRetry={() => void query.refetch()}>
        {(item) => {
          const connections = (accounts.data?.items ?? []).flatMap((account) =>
            account.connections
              .filter(
                (connection) =>
                  connection.backend === backend && connection.integration_id === item.id,
              )
              .map((connection) => ({ accountId: account.account_id, connection })),
          )
          return (
            <div className={page.stack}>
              <header className={page.header}>
                <div className={page.heading}>
                  <h1 className={page.title}>{item.code}</h1>
                  <p className={page.description}>Параметры интеграции, сервисы и подключения.</p>
                </div>
              </header>
              <IntegrationCommands item={item} onInspect={() => void query.refetch()} />
              <StatusBadge domain="integration" state={item.state} raw={item.raw} />
              <dl className={page.dl}>
                <dt>Бекенд</dt>
                <dd>{item.backend}</dd>
                <dt>client_id</dt>
                <dd>
                  <CopyableId value={item.client_id} label="client_id" />
                </dd>
                <dt>Хост редиректа</dt>
                <dd title={item.redirect_uri}>{hostFromRedirect(item.redirect_uri)}</dd>
                <dt>key_version</dt>
                <dd>{formatNull(item.key_version)}</dd>
                <dt>Обновлено</dt>
                <dd>
                  <time dateTime={item.updated_at} title={formatTime(item.updated_at)}>
                    {formatRelativeTime(item.updated_at)}
                  </time>
                </dd>
                <dt>События webhook</dt>
                <dd>
                  <WebhookEvents events={item.webhook_events} />
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
              {accounts.isPending ? (
                <PageSkeleton label="Загрузка подключений…" variant="list" />
              ) : null}
              {accounts.error ? (
                <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
              ) : null}
              {!accounts.isPending && !accounts.error && connections.length === 0 ? (
                <EmptyState
                  title="Нет подключений"
                  description="У этой интеграции нет установок в ответивших источниках. Это пустой список, а не отказ бекенда."
                />
              ) : null}
              {connections.length > 0 ? (
                <div className={page.content}>
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
                        cell: (row) => (
                          <CopyableId
                            value={row.connection.connection_id}
                            label="идентификатор подключения"
                          />
                        ),
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
                </div>
              ) : null}
            </div>
          )
        }}
      </Observation>
    </div>
  )
}
