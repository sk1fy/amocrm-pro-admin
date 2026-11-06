import { useState } from 'react'
import { ProductGrants } from '../../components/ProductGrants'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { usePushSearch, useRouteSearch } from '../../app/hooks'
import type { CursorSearch } from '../../app/search'
import { fetchIntegrations, keys } from '../../api/queries'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { PageHeader } from '../../components/PageHeader'
import { PageSkeleton } from '../../components/PageSkeleton'
import { RefreshStatus } from '../../components/RefreshStatus'
import { SourcesBanner, allSourcesUnavailable } from '../../components/SourcesBanner'
import { SourcesCaption } from '../../components/SourcesCaption'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { CreateIntegration } from './IntegrationCommands'
import { ConnectionCounts } from './ConnectionCounts'
import { WebhookEvents } from './WebhookEvents'
import commandStyles from './IntegrationCommands.module.css'
import styles from './WidgetsPage.module.css'

export function WidgetsPage() {
  const search = useRouteSearch<CursorSearch>()
  const pushSearch = usePushSearch()
  const [resultSlot, setResultSlot] = useState<HTMLDivElement | null>(null)
  const list = useQuery({
    queryKey: keys.integrations({ cursor: search.cursor, limit: 25 }),
    queryFn: () => fetchIntegrations({ cursor: search.cursor, limit: 25 }),
  })

  return (
    <div className={page.page}>
      <PageHeader
        title="Виджеты"
        description="Интеграции amoCRM: продукты, подключения и события webhook."
        actions={<CreateIntegration resultTarget={resultSlot} />}
        refresh={
          <RefreshStatus
            updatedAt={list.dataUpdatedAt}
            fetching={list.isFetching}
            failed={Boolean(list.error) && list.data !== undefined}
            onRefresh={() => void list.refetch({ cancelRefetch: false })}
            sources={list.data?.sources}
          />
        }
      />
      <div ref={setResultSlot} className={commandStyles.results} />
      <SourcesBanner sources={list.data?.sources} />
      {list.isPending ? (
        <PageSkeleton label="Загрузка каталога интеграций…" variant="list" />
      ) : null}
      {list.error && !list.data ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : null}
      {list.data && list.data.items.length === 0 ? (
        allSourcesUnavailable(list.data.sources) ? (
          <EmptyState
            title="Источник недоступен"
            description="Каталог интеграций нельзя показать, пока бекенд не ответит. Это не пустой каталог."
          />
        ) : (
          <EmptyState
            title="Нет интеграций"
            description="Источник ответил, записей нет. Создайте интеграцию кнопкой в шапке страницы."
          />
        )
      ) : null}
      {list.data && list.data.items.length > 0 ? (
        <>
          <SourcesCaption sources={list.data.sources} />
          <div className={page.content}>
            <DataTable
              rows={list.data.items}
              rowKey={(row) => `${row.backend}:${row.id}`}
              nextCursor={list.data.next_cursor}
              total={list.data.total}
              resetDisabled={!search.cursor}
              onReset={() => pushSearch('/widgets', { ...search, cursor: undefined })}
              onNext={() =>
                pushSearch('/widgets', { ...search, cursor: list.data?.next_cursor ?? undefined })
              }
              columns={[
                {
                  id: 'code',
                  header: 'Интеграция',
                  sortValue: (row) => row.code,
                  title: (row) => `${row.code} · ${row.backend}`,
                  cell: (row) => (
                    <span className={styles.name}>
                      <Link
                        to="/widgets/$backend/$integrationId"
                        params={{ backend: row.backend, integrationId: row.id }}
                      >
                        {row.code}
                      </Link>
                      {row.state === 'active' ? null : (
                        <StatusBadge domain="integration" state={row.state} raw={row.raw} calm />
                      )}
                    </span>
                  ),
                },
                {
                  id: 'grants',
                  header: 'Продукты',
                  cell: (row) => <ProductGrants grants={row.grants} />,
                },
                {
                  id: 'counts',
                  header: 'Подключения',
                  cell: (row) => <ConnectionCounts counts={row.installations_by_status} />,
                },
                {
                  id: 'events',
                  header: 'Webhook-события',
                  cell: (row) => <WebhookEvents events={row.webhook_events} />,
                },
              ]}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}
