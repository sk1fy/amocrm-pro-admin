import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { usePushSearch, useRouteSearch } from '../../app/hooks'
import type { AccountsSearch } from '../../app/search'
import { useQuery } from '@tanstack/react-query'
import { fetchAccounts, fetchCatalog, keys } from '../../api/queries'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { FilterBar, FilterField } from '../../components/FilterBar'
import {
  SourcesBanner,
  allSourcesUnavailable,
  sourcesUnavailable,
} from '../../components/SourcesBanner'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull, formatTime } from '../../lib/format'
import { lookupState, problemCodes } from '../../states'

const connectionStates = [
  'pending',
  'authorizing',
  'active',
  'reauth_required',
  'disabled',
  'uninstalled',
  'error',
]

export function AccountsPage() {
  const search = useRouteSearch<AccountsSearch>()
  const pushSearch = usePushSearch()
  const setSearch = (patch: Partial<AccountsSearch>) => {
    pushSearch('/accounts', { ...search, ...patch })
  }
  const [draft, setDraft] = useState(search.q ?? '')
  const catalog = useQuery({ queryKey: keys.catalog, queryFn: fetchCatalog })
  const params = {
    q: search.q,
    product: search.product,
    connection: search.connection,
    problem: search.problem,
    origin: search.origin,
    cursor: search.cursor,
    limit: search.limit ?? 25,
  }
  const list = useQuery({
    queryKey: keys.accounts(params),
    queryFn: () => fetchAccounts(params),
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSearch({ q: draft || undefined, cursor: undefined })
  }

  const unavailable = allSourcesUnavailable(list.data?.sources)
  const partial = sourcesUnavailable(list.data?.sources)

  return (
    <div className={page.page}>
      <h1>Аккаунты</h1>
      <FilterBar onSubmit={submit}>
        <FilterField label="Поиск" grow>
          <input
            data-testid="accounts-search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            name="q"
            placeholder="ID, домен или ссылка"
          />
        </FilterField>
        <FilterField label="Продукт">
          <select
            value={search.product ?? ''}
            onChange={(event) =>
              setSearch({ product: event.target.value || undefined, cursor: undefined })
            }
          >
            <option value="">Все</option>
            {(catalog.data?.products ?? []).map((product) => (
              <option key={product.code} value={product.code}>
                {product.display_name}
              </option>
            ))}
            <option value="fixture-widget-a">fixture-widget-a</option>
            <option value="fixture-widget-b">fixture-widget-b</option>
          </select>
        </FilterField>
        <FilterField label="Состояние подключения">
          <select
            value={search.connection ?? ''}
            onChange={(event) =>
              setSearch({ connection: event.target.value || undefined, cursor: undefined })
            }
          >
            <option value="">Все</option>
            {connectionStates.map((state) => (
              <option key={state} value={state}>
                {lookupState('connection', state).label}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Проблема">
          <select
            value={search.problem ?? ''}
            onChange={(event) =>
              setSearch({ problem: event.target.value || undefined, cursor: undefined })
            }
          >
            <option value="">Все</option>
            {problemCodes.map((problem) => (
              <option key={problem} value={problem}>
                {lookupState('problem', problem).label}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Происхождение">
          <select
            value={search.origin ?? ''}
            onChange={(event) =>
              setSearch({ origin: event.target.value || undefined, cursor: undefined })
            }
          >
            <option value="">Все</option>
            <option value="real">реальные данные</option>
            <option value="fixture">тестовые данные</option>
          </select>
        </FilterField>
        <FilterField label="На странице">
          <select
            value={String(search.limit ?? 25)}
            onChange={(event) =>
              setSearch({ limit: Number(event.target.value), cursor: undefined })
            }
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </FilterField>
        <button type="submit">Найти</button>
      </FilterBar>
      {partial ? <SourcesBanner sources={list.data?.sources} /> : null}
      {list.isPending ? <div className={page.skeleton} /> : null}
      {list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data && list.data.items.length === 0 ? (
        unavailable ? (
          <EmptyState
            title="Источник недоступен"
            description="Список аккаунтов нельзя показать, пока бекенд не ответит."
          />
        ) : (
          <EmptyState title="Ничего не найдено" description="Измените запрос или фильтры." />
        )
      ) : null}
      {list.data && list.data.items.length > 0 ? (
        <DataTable
          rows={list.data.items}
          rowKey={(row) => row.account_id}
          nextCursor={list.data.next_cursor}
          onReset={() => setSearch({ cursor: undefined })}
          onNext={() => setSearch({ cursor: list.data?.next_cursor ?? undefined })}
          columns={[
            {
              id: 'account',
              header: 'Аккаунт',
              cell: (row) => (
                <div>
                  <Link to="/accounts/$accountId" params={{ accountId: row.account_id }}>
                    {row.account_id}
                  </Link>
                  <div className={page.muted}>{row.domains.join(', ') || formatNull(null)}</div>
                </div>
              ),
            },
            {
              id: 'connections',
              header: 'Подключения',
              cell: (row) => (
                <div className={page.row}>
                  {row.connections.map((conn) => (
                    <Link
                      key={`${conn.backend}:${conn.connection_id}`}
                      to="/accounts/$accountId/widgets/$backend/$connectionId"
                      params={{
                        accountId: row.account_id,
                        backend: conn.backend,
                        connectionId: conn.connection_id,
                      }}
                    >
                      <StatusBadge
                        domain="connection"
                        state={conn.state}
                        raw={conn.raw}
                        testId="connection-badge"
                      />
                      <span className={page.muted}> {conn.integration_code}</span>
                    </Link>
                  ))}
                </div>
              ),
            },
            {
              id: 'state',
              header: 'Агрегат',
              cell: (row) => <StatusBadge domain="account" state={row.state} />,
            },
            {
              id: 'activity',
              header: 'Последняя активность',
              cell: (row) => formatTime(row.last_activity_at),
            },
            {
              id: 'origin',
              header: 'Происхождение',
              cell: (row) => <StatusBadge domain="origin" state={row.origin} />,
            },
          ]}
        />
      ) : null}
    </div>
  )
}
