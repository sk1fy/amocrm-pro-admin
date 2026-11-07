import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { usePushSearch, useRouteParams, useRouteSearch } from '../../app/hooks'
import type { CursorSearch } from '../../app/search'
import { fetchAccount, fetchAccountJobs, keys } from '../../api/queries'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { RefreshStatus } from '../../components/RefreshStatus'
import { SourcesBanner, allSourcesUnavailable } from '../../components/SourcesBanner'
import { SourcesCaption } from '../../components/SourcesCaption'
import page from '../../components/page.module.css'
import { accountWidgetNames } from './accountWidgets'
import { JobFilters } from './JobFilters'
import { JobsTable } from './JobsTable'
import styles from './AccountOperationsPage.module.css'

export function AccountOperationsPage() {
  const { accountId } = useRouteParams<{ accountId: string }>()
  const search = useRouteSearch<CursorSearch>()
  const pushSearch = usePushSearch()
  const path = `/accounts/${accountId}/operations`
  const setSearch = (patch: Partial<CursorSearch>) => {
    pushSearch(path, { ...search, ...patch })
  }
  const limit = search.limit ?? 50
  const account = useQuery({
    queryKey: keys.account(accountId),
    queryFn: () => fetchAccount(accountId),
  })
  const params = {
    status: search.status,
    type: search.type,
    limit,
    cursor: search.cursor,
  }
  const jobs = useQuery({
    queryKey: keys.accountJobs(accountId, params),
    queryFn: () => fetchAccountJobs(accountId, params),
  })
  const rows = (jobs.data?.items ?? []).map((job) => ({ job, backend: job.backend }))
  const sources = jobs.data?.sources ?? []
  const filtered = Boolean(search.status || search.type)
  const widgetNames = accountWidgetNames(account.data)
  const connections = (account.data?.connections ?? []).flatMap((item) =>
    item.data ? [item.data] : [],
  )

  return (
    <div className={page.page}>
      <JobFilters
        key={search.type ?? ''}
        values={{ status: search.status, type: search.type }}
        onChange={(patch) => setSearch({ ...patch, cursor: undefined })}
        onReset={() => pushSearch(path, { limit: search.limit })}
        aside={
          <RefreshStatus
            updatedAt={jobs.dataUpdatedAt}
            fetching={jobs.isFetching}
            failed={Boolean(jobs.error) && jobs.data !== undefined}
            onRefresh={() => void jobs.refetch({ cancelRefetch: false })}
            sources={sources}
          />
        }
      />
      <SourcesBanner sources={sources} />
      {jobs.isPending ? <div className={page.skeleton} /> : null}
      {jobs.error && !jobs.data ? (
        <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />
      ) : null}
      {jobs.data && rows.length === 0 ? (
        allSourcesUnavailable(sources) ? (
          <EmptyState
            title="Источник недоступен"
            description="Задачи аккаунта нельзя показать, пока бекенд не ответит. Это не пустой список."
          />
        ) : filtered ? (
          <EmptyState
            title="Нет задач по фильтрам"
            description="Источник ответил, но задач с такими условиями нет. Измените или сбросьте фильтры."
          />
        ) : (
          <EmptyState
            title="Нет задач по этому аккаунту"
            description="Источник ответил, задач за доступный период нет."
          />
        )
      ) : null}
      {jobs.data && rows.length > 0 ? (
        <>
          <SourcesCaption sources={sources} />
          <JobsTable
            rows={rows}
            accountId={accountId}
            widgetNames={widgetNames}
            nextCursor={jobs.data.next_cursor}
            onNext={() => setSearch({ cursor: jobs.data?.next_cursor ?? undefined })}
            onReset={() => setSearch({ cursor: undefined })}
            resetDisabled={!search.cursor}
            total={jobs.data.total}
            limit={limit}
            onLimitChange={(next) => setSearch({ limit: next, cursor: undefined })}
          />
        </>
      ) : null}
      {connections.length > 0 ? (
        <p className={styles.commands}>
          <span>Команды сотрудников по виджетам:</span>
          {connections.map((connection) => (
            <Link
              key={`${connection.backend}:${connection.connection_id}`}
              to="/operations/admin"
              search={{
                backend: connection.backend,
                target_type: 'installation',
                target_id: connection.connection_id,
              }}
              title={`История команд подключения ${connection.integration_code}`}
            >
              {connection.integration_code}
            </Link>
          ))}
        </p>
      ) : null}
    </div>
  )
}
