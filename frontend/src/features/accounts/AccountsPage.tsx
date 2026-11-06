import { verificationState, verificationTooltip } from '../../components/VerificationBadge'
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
import { FilterBar, FilterField, type FilterChip } from '../../components/FilterBar'
import { OriginTag } from '../../components/OriginTag'
import { PageHeader } from '../../components/PageHeader'
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
import type { AccountConnection } from '../../api/types'
import styles from './AccountsPage.module.css'

const connectionStates = [
  'pending',
  'authorizing',
  'active',
  'reauth_required',
  'disabled',
  'uninstalled',
  'error',
]

const verificationOptions: Record<string, string> = {
  ok: 'Доступ подтверждён',
  stale: 'Проверка устарела',
  unknown: 'Не проверено',
  failed: 'Ошибка проверки',
}

const originOptions: Record<string, string> = {
  real: 'Реальные',
  all: 'Все, включая тестовые',
  fixture: 'Только тестовые',
}

/**
 * One chip per connection (ADR-0021): a single dot shows the installation
 * state, or the amoCRM check when the installation is fine; both labels are
 * in the tooltip and the accessible name.
 */
function ConnectionChip({
  accountId,
  conn,
  unavailable,
}: {
  accountId: string
  conn: AccountConnection
  unavailable: boolean
}) {
  const installation = lookupState('connection', conn.state)
  const check = verificationState(conn.authorization_check, unavailable)
  const checkLabel = lookupState('verification', check).label
  const showCheck = installation.tone === 'ok'
  return (
    <Link
      className={styles.conn}
      to="/accounts/$accountId/widgets/$backend/$connectionId"
      params={{ accountId, backend: conn.backend, connectionId: conn.connection_id }}
      title={`Установка: ${installation.label}. Проверка amoCRM: ${checkLabel}. ${verificationTooltip(conn.authorization_check)}`}
    >
      {showCheck ? (
        <StatusBadge
          domain="verification"
          state={check}
          raw={conn.authorization_check?.raw}
          variant="dot"
        />
      ) : (
        <StatusBadge domain="connection" state={conn.state} raw={conn.raw} variant="dot" />
      )}
      <span>{conn.integration_code}</span>
    </Link>
  )
}

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
    origin: search.origin === 'all' ? undefined : (search.origin ?? 'real'),
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
      (search.origin && search.origin !== 'real'),
  )

  const chips: FilterChip[] = []
  if (search.q) chips.push({ id: 'q', label: 'Поиск', value: search.q })
  if (search.problem)
    chips.push({
      id: 'problem',
      label: 'Проблема',
      value: lookupState('problem', search.problem).label,
    })
  if (search.product) {
    const product = catalog.data?.products.find((item) => item.code === search.product)
    chips.push({ id: 'product', label: 'Продукт', value: product?.display_name ?? search.product })
  }
  if (search.verification)
    chips.push({
      id: 'verification',
      label: 'Проверка amoCRM',
      value: verificationOptions[search.verification] ?? search.verification,
    })
  if (search.connection)
    chips.push({
      id: 'connection',
      label: 'Установка',
      value: lookupState('connection', search.connection).label,
    })
  if (search.origin && search.origin !== 'real')
    chips.push({
      id: 'origin',
      label: 'Данные',
      value: originOptions[search.origin] ?? search.origin,
    })
  const secondaryActive = Boolean(
    search.verification || search.connection || (search.origin && search.origin !== 'real'),
  )

  return (
    <div className={page.page}>
      <PageHeader
        title="Аккаунты"
        description="Найдите аккаунт по ID, домену или ссылке amoCRM."
        refresh={
          <RefreshStatus
            updatedAt={list.dataUpdatedAt}
            fetching={list.isFetching}
            failed={Boolean(list.error)}
            onRefresh={() => void list.refetch({ cancelRefetch: false })}
            sources={list.data?.sources}
          />
        }
      />
      <div className={styles.toolbar}>
        <FilterBar
          onSubmit={submit}
          chips={chips}
          onRemoveChip={(id) => {
            if (id === 'q') setDraft('')
            setSearch({ [id]: id === 'origin' ? 'real' : undefined, cursor: undefined })
          }}
          onReset={() => {
            setDraft('')
            pushSearch('/accounts', { limit: search.limit })
          }}
          moreOpen={secondaryActive}
          more={
            <>
              <FilterField label="Проверка amoCRM">
                <select
                  value={search.verification ?? ''}
                  onChange={(event) =>
                    setSearch({ verification: event.target.value || undefined, cursor: undefined })
                  }
                >
                  <option value="">Любая</option>
                  {Object.entries(verificationOptions).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Состояние установки">
                <select
                  value={search.connection ?? ''}
                  onChange={(event) =>
                    setSearch({ connection: event.target.value || undefined, cursor: undefined })
                  }
                >
                  <option value="">Любое</option>
                  {connectionStates.map((state) => (
                    <option key={state} value={state}>
                      {lookupState('connection', state).label}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Происхождение">
                <select
                  value={search.origin ?? 'real'}
                  onChange={(event) => setSearch({ origin: event.target.value, cursor: undefined })}
                >
                  {Object.entries(originOptions).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </FilterField>
            </>
          }
        >
          <FilterField label="Поиск" grow>
            <input
              data-testid="accounts-search"
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              name="q"
              placeholder="ID, домен или ссылка"
            />
          </FilterField>
          <FilterField label="Проблема">
            <select
              value={search.problem ?? ''}
              onChange={(event) =>
                setSearch({ problem: event.target.value || undefined, cursor: undefined })
              }
            >
              <option value="">Любая</option>
              {problemCodes.map((problem) => (
                <option key={problem} value={problem}>
                  {lookupState('problem', problem).label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Продукт">
            <select
              value={search.product ?? ''}
              onChange={(event) =>
                setSearch({ product: event.target.value || undefined, cursor: undefined })
              }
            >
              <option value="">Любой</option>
              {(catalog.data?.products ?? []).map((product) => (
                <option key={product.code} value={product.code}>
                  {product.display_name}
                </option>
              ))}
            </select>
          </FilterField>
          <button type="submit">Найти</button>
        </FilterBar>
        <SavedViews
          section="accounts"
          current={{ ...params, origin: search.origin ?? 'real' }}
          columns={['account_id', 'domain', 'connections', 'state']}
          onLoad={(loaded) => {
            setDraft(typeof loaded.q === 'string' ? loaded.q : '')
            setSearch({
              q: typeof loaded.q === 'string' ? loaded.q : undefined,
              verification:
                typeof loaded.verification === 'string' ? loaded.verification : undefined,
              product: typeof loaded.product === 'string' ? loaded.product : undefined,
              connection: typeof loaded.connection === 'string' ? loaded.connection : undefined,
              problem: typeof loaded.problem === 'string' ? loaded.problem : undefined,
              origin: typeof loaded.origin === 'string' ? loaded.origin : 'all',
              limit: typeof loaded.limit === 'number' ? loaded.limit : search.limit,
              cursor: undefined,
            })
          }}
        />
      </div>
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
        ) : params.origin === 'real' ? (
          <section className={page.section}>
            <EmptyState
              title="Нет реальных аккаунтов"
              description="В доступных источниках пока нет реальных аккаунтов. Тестовые аккаунты скрыты текущим фильтром."
            />
            <div className={page.actions}>
              <button type="button" onClick={() => setSearch({ origin: 'all', cursor: undefined })}>
                Показать все аккаунты, включая тестовые
              </button>
            </div>
          </section>
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
              resetDisabled={!search.cursor}
              onReset={() => setSearch({ cursor: undefined })}
              onNext={() => setSearch({ cursor: list.data?.next_cursor ?? undefined })}
              limit={params.limit}
              onLimitChange={(limit) => setSearch({ limit, cursor: undefined })}
              columns={[
                {
                  id: 'account',
                  header: 'Аккаунт',
                  cell: (row) => (
                    <div className={styles.account}>
                      <div className={styles.domains}>
                        {row.domains.length === 0 ? (
                          <span className={page.muted}>{formatNull(null)}</span>
                        ) : (
                          row.domains.map((domain) => (
                            <Link
                              key={domain}
                              className={styles.domain}
                              to="/accounts/$accountId"
                              params={{ accountId: row.account_id }}
                            >
                              {domain}
                            </Link>
                          ))
                        )}
                      </div>
                      <div className={styles.accountMeta}>
                        <Link
                          className={styles.accountId}
                          to="/accounts/$accountId"
                          params={{ accountId: row.account_id }}
                        >
                          {row.account_id}
                        </Link>
                        <OriginTag origin={row.origin} />
                      </div>
                    </div>
                  ),
                },
                {
                  id: 'connections',
                  header: 'Виджеты',
                  cell: (row) =>
                    row.connections.length === 0 ? (
                      <span className={page.muted}>Нет подключений</span>
                    ) : (
                      <div className={styles.connList}>
                        {row.connections.map((conn) => (
                          <ConnectionChip
                            key={`${conn.backend}:${conn.connection_id}`}
                            accountId={row.account_id}
                            conn={conn}
                            unavailable={partial || Boolean(list.error)}
                          />
                        ))}
                      </div>
                    ),
                },
                {
                  id: 'state',
                  header: 'Состояние',
                  cell: (row) => <StatusBadge domain="account" state={row.state} calm />,
                },
                {
                  id: 'activity',
                  header: 'Активность',
                  nowrap: true,
                  cell: (row) => (
                    <time
                      className={page.muted}
                      dateTime={row.last_activity_at ?? undefined}
                      title={row.last_activity_at ? formatTime(row.last_activity_at) : undefined}
                    >
                      {formatRelativeTime(row.last_activity_at)}
                    </time>
                  ),
                },
              ]}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}
