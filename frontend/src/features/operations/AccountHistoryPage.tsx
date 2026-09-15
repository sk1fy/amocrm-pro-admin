import { useQuery } from '@tanstack/react-query'
import { usePushSearch, useRouteParams, useRouteSearch } from '../../app/hooks'
import type { CursorSearch } from '../../app/search'
import { fetchAccountHistory, keys } from '../../api/queries'
import type { HistoryItem } from '../../api/types'
import { DataTablePager } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { SourcesBanner } from '../../components/SourcesBanner'
import { SourcesCaption } from '../../components/SourcesCaption'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull, formatTime } from '../../lib/format'
import { actorLabel, auditLabel, isFailedAudit } from '../../lib/labels'
import styles from './AccountHistoryPage.module.css'

export function historyObjectHref(item: HistoryItem, accountId: string): string | null {
  if (item.connection_id && item.backend) {
    return `/accounts/${accountId}/widgets/${item.backend}/${item.connection_id}`
  }
  if (item.object_type === 'account' && item.object_id) {
    return `/accounts/${item.object_id}`
  }
  if (item.object_ref?.startsWith('account:')) {
    const id = item.object_ref.slice('account:'.length)
    return id ? `/accounts/${id}` : null
  }
  if (item.object_type === 'job' || item.object_ref?.includes('job:')) {
    return '/operations'
  }
  if (item.object_ref?.startsWith('/accounts/') || item.object_ref?.startsWith('/operations/')) {
    return item.object_ref
  }
  return null
}

export function AccountHistoryPage() {
  const { accountId } = useRouteParams<{ accountId: string }>()
  const search = useRouteSearch<CursorSearch>()
  const pushSearch = usePushSearch()
  const history = useQuery({
    queryKey: keys.accountHistory(accountId, { cursor: search.cursor, limit: 25 }),
    queryFn: () => fetchAccountHistory(accountId, { cursor: search.cursor, limit: 25 }),
  })

  if (history.isPending) {
    return <div className={page.skeleton} />
  }
  if (history.error) {
    return <ErrorState error={history.error} onRetry={() => void history.refetch()} />
  }
  const items = history.data?.items ?? []
  return (
    <div className={page.page}>
      <SourcesBanner sources={history.data?.sources} />
      {items.length === 0 ? <EmptyState title="История пуста" /> : null}
      {items.length > 0 ? (
        <>
          <SourcesCaption sources={history.data?.sources} />
          <ol className={styles.timeline}>
            {items.map((item) => {
              const href = historyObjectHref(item, accountId)
              const objectText = formatNull(item.object_ref ?? item.object_id)
              const failed = isFailedAudit(item.action, item.outcome)
              return (
                <li
                  key={`${item.source}:${item.occurred_at}:${item.action}:${item.object_id ?? ''}`}
                  className={failed ? styles.failed : undefined}
                >
                  <time dateTime={item.occurred_at}>{formatTime(item.occurred_at)}</time>
                  <div className={styles.body}>
                    <p className={styles.action}>
                      {auditLabel(item.action)}
                      <span className={styles.code}> {item.action}</span>
                    </p>
                    <p className={styles.meta}>
                      {item.source}
                      {' · '}
                      {actorLabel(item.actor_type)}
                      {item.actor_email ? ` · ${item.actor_email}` : ''}
                    </p>
                    <p className={styles.object}>
                      {href ? <a href={href}>{objectText}</a> : objectText}
                    </p>
                    {item.outcome || failed ? (
                      <StatusBadge
                        domain="audit_outcome"
                        state={item.outcome || (failed ? 'failed' : 'ok')}
                      />
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ol>
          <DataTablePager
            rowCount={items.length}
            total={history.data?.total}
            nextCursor={history.data?.next_cursor}
            resetDisabled={!search.cursor}
            onReset={() =>
              pushSearch(`/accounts/${accountId}/history`, { ...search, cursor: undefined })
            }
            onNext={() =>
              pushSearch(`/accounts/${accountId}/history`, {
                ...search,
                cursor: history.data?.next_cursor ?? undefined,
              })
            }
          />
        </>
      ) : null}
    </div>
  )
}
