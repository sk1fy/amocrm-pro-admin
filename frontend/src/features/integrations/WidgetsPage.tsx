import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { usePushSearch, useRouteSearch } from '../../app/hooks'
import type { CursorSearch } from '../../app/search'
import { fetchIntegrations, keys } from '../../api/queries'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { PageSkeleton } from '../../components/PageSkeleton'
import { SourcesBanner, allSourcesUnavailable } from '../../components/SourcesBanner'
import { SourcesCaption } from '../../components/SourcesCaption'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull, hostFromRedirect } from '../../lib/format'
import { CreateIntegration } from './IntegrationCommands'
import { WebhookEvents } from './WebhookEvents'

export function WidgetsPage() {
  const search = useRouteSearch<CursorSearch>()
  const pushSearch = usePushSearch()
  const list = useQuery({
    queryKey: keys.integrations({ cursor: search.cursor, limit: 25 }),
    queryFn: () => fetchIntegrations({ cursor: search.cursor, limit: 25 }),
  })

  return (
    <div className={page.page}>
      <header className={page.header}>
        <div className={page.heading}>
          <h1 className={page.title}>Виджеты</h1>
          <p className={page.description}>
            Каталог интеграций: состояние, сервисы, подключения и события webhook.
          </p>
        </div>
        <CreateIntegration />
      </header>
      <SourcesBanner sources={list.data?.sources} />
      {list.isPending ? (
        <PageSkeleton label="Загрузка каталога интеграций…" variant="list" />
      ) : null}
      {list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
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
              onReset={() => pushSearch('/widgets', { ...search, cursor: undefined })}
              onNext={() =>
                pushSearch('/widgets', { ...search, cursor: list.data?.next_cursor ?? undefined })
              }
              columns={[
                {
                  id: 'code',
                  header: 'Код',
                  cell: (row) => (
                    <Link
                      to="/widgets/$backend/$integrationId"
                      params={{ backend: row.backend, integrationId: row.id }}
                    >
                      {row.code}
                    </Link>
                  ),
                },
                {
                  id: 'state',
                  header: 'Состояние',
                  cell: (row) => (
                    <StatusBadge domain="integration" state={row.state} raw={row.raw} />
                  ),
                },
                {
                  id: 'grants',
                  header: 'Сервисы',
                  cell: (row) =>
                    row.grants.length === 0
                      ? formatNull(null)
                      : row.grants.map((grant) => (
                          <span key={grant.service}>
                            {grant.service}:{' '}
                            <StatusBadge domain="grant" state={grant.state} raw={grant.raw} />{' '}
                          </span>
                        )),
                },
                {
                  id: 'counts',
                  header: 'Подключения',
                  cell: (row) =>
                    Object.keys(row.installations_by_status).length === 0 ? (
                      formatNull(0)
                    ) : (
                      <span className={page.row}>
                        {Object.entries(row.installations_by_status).map(([status, count]) => (
                          <span key={status} className={page.row}>
                            <StatusBadge domain="connection" state={status} />
                            <span className={page.muted}>{formatNull(count)}</span>
                          </span>
                        ))}
                      </span>
                    ),
                },
                {
                  id: 'redirect',
                  header: 'Хост редиректа',
                  cell: (row) => (
                    <span title={row.redirect_uri}>{hostFromRedirect(row.redirect_uri)}</span>
                  ),
                },
                {
                  id: 'events',
                  header: 'Webhook',
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
