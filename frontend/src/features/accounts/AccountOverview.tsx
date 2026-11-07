import { Link } from '@tanstack/react-router'
import { useRouteParams } from '../../app/hooks'
import { useQuery } from '@tanstack/react-query'
import { fetchAccount, keys } from '../../api/queries'
import type { AccountConnectionCard, Observation as ObservationValue } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { Observation } from '../../components/Observation'
import { ProductGrants } from '../../components/ProductGrants'
import { StatusBadge } from '../../components/StatusBadge'
import { VerificationBadge } from '../../components/VerificationBadge'
import page from '../../components/page.module.css'
import { allSourcesUnavailable } from '../../components/SourcesBanner'
import { AccountSubscription } from './AccountSubscription'
import styles from './AccountOverview.module.css'

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
      <section className={page.section} aria-labelledby="account-connections">
        <h2 id="account-connections">Подключённые виджеты</h2>
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
              <ConnectionCard
                key={`${obs.source}:${obs.data?.connection_id ?? obs.observed_at}`}
                accountId={accountId}
                observation={obs}
              />
            ))}
          </div>
        )}
      </section>
      <AccountSubscription accountId={accountId} />
    </div>
  )
}

function ConnectionCard({
  accountId,
  observation,
}: {
  accountId: string
  observation: ObservationValue<AccountConnectionCard>
}) {
  return (
    <Observation observation={observation}>
      {(conn) => (
        <Link
          className={`${styles.card} ${page.cardLink}`}
          to="/accounts/$accountId/widgets/$backend/$connectionId"
          params={{ accountId, backend: conn.backend, connectionId: conn.connection_id }}
        >
          <div className={styles.head}>
            <h3 className={styles.name}>{conn.integration_code}</h3>
            <StatusBadge
              domain="connection"
              state={conn.state}
              raw={conn.raw}
              testId="connection-badge"
              calm
            />
          </div>
          <ProductGrants grants={conn.grants} />
          <dl className={styles.facts}>
            <dt>Авторизация</dt>
            <dd>
              <StatusBadge domain="authorization" state={conn.authorization?.state} calm />
              <VerificationBadge verification={conn.authorization_check} variant="text" />
            </dd>
            <dt>Webhook</dt>
            <dd>
              <StatusBadge domain="webhook" state={conn.webhook?.status} calm />
            </dd>
          </dl>
          {conn.webhook?.last_error ? (
            <p className={styles.error}>{conn.webhook.last_error}</p>
          ) : null}
          {observation.freshness === 'stale' ? (
            <p className={page.muted}>
              Данные этого подключения устарели. Это не состояние «всё в порядке».
            </p>
          ) : null}
        </Link>
      )}
    </Observation>
  )
}
