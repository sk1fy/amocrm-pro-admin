import { useState } from 'react'
import { ProductGrants } from '../../components/ProductGrants'
import { useQuery } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'
import { useRouteParams } from '../../app/hooks'
import { fetchAccounts, fetchIntegration, keys } from '../../api/queries'
import type { AccountConnection, Integration } from '../../api/types'
import { CopyableId } from '../../components/CopyableId'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Observation } from '../../components/Observation'
import { PageHeader } from '../../components/PageHeader'
import { PageSkeleton } from '../../components/PageSkeleton'
import { RefreshStatus } from '../../components/RefreshStatus'
import { SourcesBanner, allSourcesUnavailable } from '../../components/SourcesBanner'
import { StatusBadge } from '../../components/StatusBadge'
import { TechnicalDetails } from '../../components/TechnicalDetails'
import page from '../../components/page.module.css'
import { formatNull, formatRelativeTime, formatTime, hostFromRedirect } from '../../lib/format'
import { ConnectionCounts } from './ConnectionCounts'
import { IntegrationCommands } from './IntegrationCommands'
import commandStyles from './IntegrationCommands.module.css'
import styles from './IntegrationPage.module.css'
import { WebhookEvents } from './WebhookEvents'

type ConnectionRow = {
  accountId: string
  domain: string | undefined
  connection: AccountConnection
}

function connectionPath(row: ConnectionRow): string {
  return `/accounts/${row.accountId}/widgets/${row.connection.backend}/${row.connection.connection_id}`
}

function IntegrationConnections({ item }: { item: Integration }) {
  const router = useRouter()
  const accountParams = { integration_id: item.id, backend: item.backend, limit: 100 }
  const accounts = useQuery({
    queryKey: keys.accounts(accountParams),
    queryFn: () => fetchAccounts(accountParams),
  })
  const rows: ConnectionRow[] = (accounts.data?.items ?? []).flatMap((account) =>
    account.connections
      .filter(
        (connection) =>
          connection.backend === item.backend && connection.integration_id === item.id,
      )
      .map((connection) => ({
        accountId: account.account_id,
        domain: account.domains[0],
        connection,
      })),
  )
  return (
    <section className={styles.section} aria-labelledby="integration-connections">
      <h2 id="integration-connections">Подключения</h2>
      <SourcesBanner sources={accounts.data?.sources} />
      {accounts.isPending ? <PageSkeleton label="Загрузка подключений…" variant="list" /> : null}
      {accounts.error ? (
        <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : null}
      {!accounts.isPending && !accounts.error && rows.length === 0 ? (
        allSourcesUnavailable(accounts.data?.sources) ? (
          <EmptyState
            title="Источник недоступен"
            description="Подключения нельзя показать, пока бекенд не ответит."
          />
        ) : (
          <EmptyState
            title="Нет подключений"
            description="У этой интеграции нет установок в ответивших источниках."
          />
        )
      ) : null}
      {rows.length > 0 ? (
        <DataTable
          rows={rows}
          rowKey={(row) => `${row.connection.backend}:${row.connection.connection_id}`}
          onRowClick={(row) => router.history.push(connectionPath(row))}
          columns={[
            {
              id: 'account',
              header: 'Аккаунт',
              sortValue: (row) => row.domain ?? row.accountId,
              title: (row) => `Аккаунт ${row.accountId}`,
              cell: (row) => (
                <span className={styles.account}>
                  <Link
                    to="/accounts/$accountId/widgets/$backend/$connectionId"
                    params={{
                      accountId: row.accountId,
                      backend: row.connection.backend,
                      connectionId: row.connection.connection_id,
                    }}
                  >
                    {row.domain ?? row.accountId}
                  </Link>
                  {row.domain ? <span className={styles.muted}>ID {row.accountId}</span> : null}
                </span>
              ),
            },
            {
              id: 'state',
              header: 'Состояние',
              nowrap: true,
              sortValue: (row) => row.connection.state,
              cell: (row) => (
                <StatusBadge
                  domain="connection"
                  state={row.connection.state}
                  raw={row.connection.raw}
                  calm
                />
              ),
            },
          ]}
        />
      ) : null}
    </section>
  )
}

function IntegrationBody({ item }: { item: Integration }) {
  return (
    <div className={styles.body}>
      <section className={styles.section} aria-labelledby="integration-products">
        <h2 id="integration-products">Продукты</h2>
        <ProductGrants grants={item.grants} />
      </section>
      <IntegrationConnections item={item} />
      <TechnicalDetails summary="Технические данные">
        <dl className={page.dl}>
          <dt>Бекенд</dt>
          <dd>{item.backend}</dd>
          <dt>Идентификатор интеграции Core</dt>
          <dd>
            <CopyableId value={item.id} label="ID интеграции Core" />
          </dd>
          <dt>OAuth UUID (client_id)</dt>
          <dd>
            <CopyableId value={item.client_id} label="client_id" />
          </dd>
          <dt>Хост редиректа</dt>
          <dd title={item.redirect_uri}>{hostFromRedirect(item.redirect_uri)}</dd>
          <dt>Версия секрета (key_version)</dt>
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
      </TechnicalDetails>
    </div>
  )
}

export function IntegrationPage() {
  const { backend, integrationId } = useRouteParams<{ backend: string; integrationId: string }>()
  const [resultSlot, setResultSlot] = useState<HTMLDivElement | null>(null)
  const query = useQuery({
    queryKey: keys.integration(backend, integrationId),
    queryFn: () => fetchIntegration(backend, integrationId),
  })
  if (query.isPending) {
    return <PageSkeleton label="Загрузка интеграции…" variant="detail" />
  }
  if (query.error && !query.data) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  }
  if (!query.data) {
    return null
  }
  const item = query.data.data ?? null
  return (
    <div className={page.page}>
      <PageHeader
        title={item?.code ?? 'Интеграция'}
        meta={
          item ? (
            <>
              {item.state === 'active' ? null : (
                <StatusBadge domain="integration" state={item.state} raw={item.raw} calm />
              )}
              <ConnectionCounts counts={item.installations_by_status} wordy />
            </>
          ) : null
        }
        actions={
          item ? (
            <IntegrationCommands
              item={item}
              onInspect={() => void query.refetch()}
              resultTarget={resultSlot}
            />
          ) : null
        }
        refresh={
          <RefreshStatus
            updatedAt={query.dataUpdatedAt}
            fetching={query.isFetching}
            failed={Boolean(query.error)}
            onRefresh={() => void query.refetch({ cancelRefetch: false })}
          />
        }
      />
      <div ref={setResultSlot} className={commandStyles.results} />
      <Observation observation={query.data} onRetry={() => void query.refetch()}>
        {(data) => <IntegrationBody item={data} />}
      </Observation>
    </div>
  )
}
