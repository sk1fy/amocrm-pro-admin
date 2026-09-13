import { useQuery } from '@tanstack/react-query'
import { fetchSubscription, keys } from '../../api/queries'
import type { Observation as ObservationType, SourceStatus, Subscription } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Observation } from '../../components/Observation'
import {
  SourcesBanner,
  allSourcesUnavailable,
  sourcesUnavailable,
} from '../../components/SourcesBanner'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull, formatTime } from '../../lib/format'
import styles from './AccountSubscription.module.css'

export function SubscriptionCard({ data }: { data: Subscription }) {
  return (
    <div className={page.card}>
      <div className={page.row}>
        <h3>{formatNull(data.plan)}</h3>
        <StatusBadge
          domain="subscription"
          state={data.state}
          raw={data.raw}
          testId="subscription-badge"
        />
      </div>
      <p>
        Действует до:{' '}
        <time dateTime={data.expires_at ?? undefined}>{formatTime(data.expires_at)}</time>
      </p>
      <p>
        Возможности:{' '}
        {data.capabilities.length > 0 ? data.capabilities.join(', ') : formatNull(null)}
      </p>
    </div>
  )
}

export function SubscriptionList({
  items,
  sources,
  onRetry,
}: {
  items: ObservationType<Subscription>[]
  sources?: SourceStatus[] | null
  onRetry?: () => void
}) {
  const partial = sourcesUnavailable(sources)
  const allUnavailable = allSourcesUnavailable(sources)
  return (
    <div className={page.stack}>
      {partial ? <SourcesBanner sources={sources} /> : null}
      {items.length > 0 ? (
        <div className={page.cards}>
          {items.map((obs) => (
            <Observation
              key={`${obs.source}:${obs.observed_at}`}
              observation={obs}
              onRetry={onRetry}
            >
              {(data) => <SubscriptionCard data={data} />}
            </Observation>
          ))}
        </div>
      ) : allUnavailable ? (
        <EmptyState title="Источник недоступен" />
      ) : partial ? null : (
        <div className={`${page.card} ${styles.unknown}`} role="status">
          <strong>Данные подписки недоступны</strong>
        </div>
      )}
    </div>
  )
}

export function AccountSubscription({ accountId }: { accountId: string }) {
  const subscription = useQuery({
    queryKey: keys.subscription(accountId),
    queryFn: () => fetchSubscription(accountId),
  })
  return (
    <section className={page.stack}>
      <h2>Подписка</h2>
      {subscription.isPending ? (
        <div className={page.skeleton} />
      ) : subscription.error ? (
        <ErrorState error={subscription.error} onRetry={() => void subscription.refetch()} />
      ) : (
        <SubscriptionList
          items={subscription.data?.items ?? []}
          sources={subscription.data?.sources}
          onRetry={() => void subscription.refetch()}
        />
      )}
    </section>
  )
}
