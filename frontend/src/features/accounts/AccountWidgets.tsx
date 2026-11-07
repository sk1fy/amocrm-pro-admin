import { ProductGrants } from '../../components/ProductGrants'
import { VerificationBadge } from '../../components/VerificationBadge'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useRouteParams } from '../../app/hooks'
import { fetchAccount, keys } from '../../api/queries'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { allSourcesUnavailable } from '../../components/SourcesBanner'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull, formatTime } from '../../lib/format'
import styles from './AccountWidgets.module.css'

export function AccountWidgets() {
  const { accountId } = useRouteParams<{ accountId: string }>()
  const account = useQuery({
    queryKey: keys.account(accountId),
    queryFn: () => fetchAccount(accountId),
  })
  if (!account.data) {
    return null
  }
  if (account.data.connections.length === 0) {
    if (allSourcesUnavailable(account.data.sources)) {
      return (
        <EmptyState
          title="Источник недоступен"
          description="Подключения нельзя показать, пока бекенд не ответит."
        />
      )
    }
    return <EmptyState title="Нет подключений" />
  }
  return (
    <DataTable
      rows={account.data.connections}
      rowKey={(obs) => `${obs.source}:${obs.data?.connection_id ?? obs.observed_at}`}
      columns={[
        {
          id: 'integration',
          header: 'Виджет',
          title: (obs) => `Данные на ${formatTime(obs.observed_at)} · источник: ${obs.source}`,
          cell: (obs) => (
            <div className={styles.widget}>
              {obs.data ? (
                <Link
                  className={styles.name}
                  to="/accounts/$accountId/widgets/$backend/$connectionId"
                  params={{
                    accountId,
                    backend: obs.data.backend,
                    connectionId: obs.data.connection_id,
                  }}
                >
                  {formatNull(obs.data.integration_code)}
                </Link>
              ) : (
                formatNull(null)
              )}
              {obs.freshness === 'unavailable' || obs.freshness === 'unknown' ? (
                <StatusBadge domain="freshness" state={obs.freshness} />
              ) : (
                <ProductGrants grants={obs.data?.grants} />
              )}
            </div>
          ),
        },
        {
          id: 'state',
          header: 'Установка',
          cell: (obs) => (
            <div className={page.stack}>
              <StatusBadge
                domain="connection"
                state={obs.data?.state}
                raw={obs.data?.raw}
                testId="connection-badge"
                calm
              />
              {obs.freshness === 'stale' ? (
                <StatusBadge domain="freshness" state="stale" variant="text" />
              ) : null}
            </div>
          ),
        },
        {
          id: 'authorization',
          header: 'Авторизация',
          cell: (obs) =>
            obs.data ? (
              <div className={page.stack}>
                <StatusBadge domain="authorization" state={obs.data.authorization?.state} calm />
                <VerificationBadge
                  verification={obs.data.authorization_check}
                  unavailable={obs.freshness === 'unavailable'}
                  variant="text"
                />
              </div>
            ) : (
              formatNull(null)
            ),
        },
        {
          id: 'webhook',
          header: 'Webhook',
          cell: (obs) => <StatusBadge domain="webhook" state={obs.data?.webhook?.status} calm />,
        },
        {
          id: 'pilot',
          header: 'Контроль активности',
          cell: (obs) =>
            obs.freshness === 'unavailable' || obs.freshness === 'unknown' ? (
              <StatusBadge domain="freshness" state={obs.freshness} />
            ) : (
              <StatusBadge
                domain="pilot"
                state={obs.data?.activity?.pilot}
                raw={obs.data?.activity?.pilot_raw}
                calm
              />
            ),
        },
      ]}
    />
  )
}
