import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { usePushSearch, useRouteSearch } from '../../app/hooks'
import { fetchStatsAccounts, keys } from '../../api/queries'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { FilterBar, FilterField } from '../../components/FilterBar'
import { SourcesBanner } from '../../components/SourcesBanner'
import page from '../../components/page.module.css'
import { formatNull } from '../../lib/format'
import { SavedViews } from './SavedViews'

export type StatsAccountsSearch = {
  metric?: string
  period?: string
  product?: string
  cursor?: string
}

export function StatsAccountsPage() {
  const search = useRouteSearch<StatsAccountsSearch>()
  const pushSearch = usePushSearch()
  const period = search.period ?? '24h'
  const metric = search.metric ?? 'auth_problems'
  const params = { metric, period, product: search.product, cursor: search.cursor }
  const list = useQuery({
    queryKey: keys.statsAccounts(params),
    queryFn: () => fetchStatsAccounts(params),
  })

  return (
    <div className={page.page}>
      <h1>Аккаунты статистики</h1>
      <FilterBar
        onSubmit={(event) => {
          event.preventDefault()
        }}
      >
        <FilterField label="Показатель">
          <select
            value={metric}
            onChange={(event) =>
              pushSearch('/stats/accounts', {
                ...search,
                metric: event.target.value,
                cursor: undefined,
              })
            }
          >
            <option value="connected">Новые подключения</option>
            <option value="disconnected">Отключения</option>
            <option value="active">Активные аккаунты</option>
            <option value="auth_problems">Проблемы авторизации</option>
            <option value="sync_problems">Проблемы синхронизации</option>
          </select>
        </FilterField>
        <FilterField label="Период">
          <select
            value={period}
            onChange={(event) =>
              pushSearch('/stats/accounts', {
                ...search,
                period: event.target.value,
                cursor: undefined,
              })
            }
          >
            <option value="24h">24 часа</option>
            <option value="7d">7 дней</option>
            <option value="30d">30 дней</option>
          </select>
        </FilterField>
      </FilterBar>
      <SavedViews
        section="stats"
        current={params}
        columns={['account', 'domain', 'reason']}
        onLoad={(loaded) =>
          pushSearch('/stats/accounts', {
            metric: String(loaded.metric ?? metric),
            period: String(loaded.period ?? period),
            product: typeof loaded.product === 'string' ? loaded.product : undefined,
            cursor: undefined,
          })
        }
      />
      {list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      <SourcesBanner sources={list.data?.sources} />
      {list.isPending ? <div className={page.skeleton} /> : null}
      {list.data && list.data.items.length === 0 ? (
        <EmptyState title="Нет аккаунтов" description="Для этого показателя список пуст." />
      ) : null}
      {list.data && list.data.items.length > 0 ? (
        <DataTable
          rows={list.data.items}
          rowKey={(row) => `${row.backend}:${row.installation_id}`}
          nextCursor={list.data.next_cursor}
          onNext={() =>
            pushSearch('/stats/accounts', {
              ...search,
              cursor: list.data?.next_cursor ?? undefined,
            })
          }
          onReset={() => pushSearch('/stats/accounts', { ...search, cursor: undefined })}
          columns={[
            {
              id: 'account',
              header: 'Аккаунт',
              cell: (row) => (
                <Link to="/accounts/$accountId" params={{ accountId: row.account_id }}>
                  {row.account_id}
                </Link>
              ),
            },
            {
              id: 'domain',
              header: 'Домен',
              cell: (row) => formatNull(row.domain),
            },
            {
              id: 'reason',
              header: 'Причина',
              cell: (row) => formatNull(row.reason),
            },
          ]}
        />
      ) : null}
    </div>
  )
}
