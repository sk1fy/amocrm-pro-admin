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
          header: 'Интеграция',
          cell: (obs) =>
            obs.data ? (
              <Link
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
            ),
        },
        {
          id: 'state',
          header: 'Состояние',
          cell: (obs) => (
            <StatusBadge
              domain="connection"
              state={obs.data?.state}
              raw={obs.data?.raw}
              testId="connection-badge"
            />
          ),
        },
        {
          id: 'authorization',
          header: 'Авторизация',
          cell: (obs) =>
            obs.data ? (
              <span className={page.row}>
                <StatusBadge domain="authorization" state={obs.data.authorization?.state} />
                {obs.data.authorization?.unverified ? (
                  <span className={page.muted}>не проверено запросом к amoCRM</span>
                ) : null}
              </span>
            ) : (
              formatNull(null)
            ),
        },
        {
          id: 'webhook',
          header: 'Webhook',
          cell: (obs) => <StatusBadge domain="webhook" state={obs.data?.webhook?.status} />,
        },
        {
          id: 'pilot',
          header: 'Пилот',
          cell: (obs) => (
            <StatusBadge domain="pilot" state={obs.data?.activity?.pilot || 'not_configured'} />
          ),
        },
        {
          id: 'observed',
          header: 'Обновлено',
          cell: (obs) => formatTime(obs.observed_at),
        },
      ]}
    />
  )
}
