import { VerificationBadge } from '../../components/VerificationBadge'
import { RefreshStatus } from '../../components/RefreshStatus'
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
import { PageSkeleton } from '../../components/PageSkeleton'
import {
  SourcesBanner,
  allSourcesUnavailable,
  sourcesUnavailable,
} from '../../components/SourcesBanner'
import { SourcesCaption } from '../../components/SourcesCaption'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatNull, formatRelativeTime, formatTime } from '../../lib/format'
import { lookupState, problemCodes } from '../../states'
import { SavedViews } from '../overview/SavedViews'

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
    verification: search.verification,
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
  const filtered = Boolean(
    search.verification ||
      search.q ||
      search.product ||
      search.connection ||
      search.problem ||
      search.origin,
  )

  return (
    <div className={page.page}>
      <header className={page.header}>
        <div className={page.heading}>
          <h1 className={page.title}>Аккаунты</h1>
          <p className={page.description}>
            Поиск по ID, домену или ссылке amoCRM. Состояние аккаунта и статусы подключений — разные
            факты.
          </p>
        </div>
      </header>
      <RefreshStatus
        updatedAt={list.dataUpdatedAt}
        fetching={list.isFetching}
        failed={Boolean(list.error)}
        onRefresh={() => void list.refetch({ cancelRefetch: false })}
      />
      <div className={page.filters}>
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
            </select>
          </FilterField>
          <FilterField label="Проверка amoCRM">
            <select
              value={search.verification ?? ''}
              onChange={(event) =>
                setSearch({ verification: event.target.value || undefined, cursor: undefined })
              }
            >
              <option value="">Все</option>
              <option value="ok">Доступ подтверждён</option>
              <option value="stale">Проверка устарела</option>
              <option value="unknown">Не проверено</option>
              <option value="failed">Ошибка проверки</option>
            </select>
          </FilterField>
          <FilterField label="Состояние установки">
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
      </div>
      <SavedViews
        section="accounts"
        current={params}
        columns={['account_id', 'domain', 'connections', 'state']}
        onLoad={(loaded) =>
          setSearch({
            q: typeof loaded.q === 'string' ? loaded.q : undefined,
            verification: typeof loaded.verification === 'string' ? loaded.verification : undefined,
            product: typeof loaded.product === 'string' ? loaded.product : undefined,
            connection: typeof loaded.connection === 'string' ? loaded.connection : undefined,
            problem: typeof loaded.problem === 'string' ? loaded.problem : undefined,
            origin: typeof loaded.origin === 'string' ? loaded.origin : undefined,
            limit: typeof loaded.limit === 'number' ? loaded.limit : search.limit,
            cursor: undefined,
          })
        }
      />
      {partial ? <SourcesBanner sources={list.data?.sources} /> : null}
      {list.isPending ? <PageSkeleton label="Загрузка списка аккаунтов…" variant="list" /> : null}
      {list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data && list.data.items.length === 0 ? (
        unavailable ? (
          <EmptyState
            title="Источник недоступен"
            description="Список аккаунтов нельзя показать, пока бекенд не ответит. Это не пустой результат поиска."
          />
        ) : list.data.next_cursor ? (
          <section className={page.card}>
            <p>В проверенной части списка совпадений нет. Поиск ещё не завершён.</p>
            <button
              type="button"
              onClick={() => setSearch({ cursor: list.data?.next_cursor ?? undefined })}
            >
              Продолжить поиск
            </button>
          </section>
        ) : filtered ? (
          <EmptyState
            title="Ничего не найдено"
            description="По запросу и фильтрам нет аккаунтов. Источник ответил, список пуст."
          />
        ) : (
          <EmptyState
            title="Нет аккаунтов"
            description="В доступных источниках пока нет аккаунтов. Если ожидали данные, проверьте бекенд на странице «Система»."
          />
        )
      ) : null}
      {list.data && list.data.items.length > 0 ? (
        <>
          <SourcesCaption sources={list.data.sources} />
          <div className={page.content}>
            <DataTable
              rows={list.data.items}
              rowKey={(row) => row.account_id}
              nextCursor={list.data.next_cursor}
              onReset={() => setSearch({ cursor: undefined })}
              onNext={() => setSearch({ cursor: list.data?.next_cursor ?? undefined })}
              columns={[
                {
                  id: 'account_id',
                  header: 'ID аккаунта',
                  cell: (row) => (
                    <Link to="/accounts/$accountId" params={{ accountId: row.account_id }}>
                      {row.account_id}
                    </Link>
                  ),
                },
                {
                  id: 'domain',
                  header: 'Домен',
                  cell: (row) =>
                    row.domains.length === 0 ? (
                      formatNull(null)
                    ) : (
                      <div className={page.stack}>
                        {row.domains.map((domain) => (
                          <Link
                            key={domain}
                            to="/accounts/$accountId"
                            params={{ accountId: row.account_id }}
                          >
                            {domain}
                          </Link>
                        ))}
                      </div>
                    ),
                },
                {
                  id: 'connections',
                  header: 'Подключения',
                  cell: (row) =>
                    row.connections.length === 0 ? (
                      formatNull(null)
                    ) : (
                      <div className={page.connList}>
                        {row.connections.map((conn) => (
                          <Link
                            key={`${conn.backend}:${conn.connection_id}`}
                            className={page.conn}
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
                            <span>{conn.integration_code}</span>
                            <VerificationBadge
                              verification={conn.authorization_check}
                              unavailable={partial || Boolean(list.error)}
                            />
                          </Link>
                        ))}
                      </div>
                    ),
                },
                {
                  id: 'state',
                  header: 'Аккаунт',
                  cell: (row) => <StatusBadge domain="account" state={row.state} />,
                },
                {
                  id: 'activity',
                  header: 'Последняя активность',
                  cell: (row) => (
                    <time
                      dateTime={row.last_activity_at ?? undefined}
                      title={row.last_activity_at ? formatTime(row.last_activity_at) : undefined}
                    >
                      {formatRelativeTime(row.last_activity_at)}
                    </time>
                  ),
                },
                {
                  id: 'origin',
                  header: 'Происхождение',
                  cell: (row) => <StatusBadge domain="origin" state={row.origin} />,
                },
              ]}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}
