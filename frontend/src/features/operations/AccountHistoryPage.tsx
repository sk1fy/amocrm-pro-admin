import { useQuery } from '@tanstack/react-query'
import { usePushSearch, useRouteParams, useRouteSearch } from '../../app/hooks'
import type { CursorSearch } from '../../app/search'
import { fetchAccountHistory, keys } from '../../api/queries'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { SourcesBanner } from '../../components/SourcesBanner'
import { SourcesCaption } from '../../components/SourcesCaption'
import page from '../../components/page.module.css'
import { formatNull, formatTime } from '../../lib/format'

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
          <DataTable
            rows={items}
            rowKey={(item) => `${item.source}:${item.occurred_at}:${item.action}`}
            nextCursor={history.data?.next_cursor}
            onReset={() =>
              pushSearch(`/accounts/${accountId}/history`, { ...search, cursor: undefined })
            }
            onNext={() =>
              pushSearch(`/accounts/${accountId}/history`, {
                ...search,
                cursor: history.data?.next_cursor ?? undefined,
              })
            }
            columns={[
              {
                id: 'when',
                header: 'Когда',
                cell: (item) => formatTime(item.occurred_at),
              },
              {
                id: 'source',
                header: 'Источник',
                cell: (item) => item.source,
              },
              {
                id: 'action',
                header: 'Действие',
                cell: (item) => item.action,
              },
              {
                id: 'actor',
                header: 'Актор',
                cell: (item) => formatNull(item.actor_email ?? item.actor_id ?? item.actor_type),
              },
              {
                id: 'object',
                header: 'Объект',
                cell: (item) => formatNull(item.object_ref ?? item.object_id),
              },
            ]}
          />
        </>
      ) : null}
    </div>
  )
}
