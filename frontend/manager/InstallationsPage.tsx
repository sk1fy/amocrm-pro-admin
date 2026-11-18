import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useEffect, useState } from 'react'
import { isApiError, isForbidden, isUnauthorized } from '../src/api/client'
import { DataTablePager } from '../src/components/DataTable'
import { EmptyState } from '../src/components/EmptyState'
import { StatusBadge } from '../src/components/StatusBadge'
import { EMPTY, formatTime } from '../src/lib/format'
import { accountSearch, ManagerLink } from './accountsLocation'
import { InstallationFilters } from './InstallationFilters'
import { listInstallations, type Installation } from './installationsApi'
import { getInstallationSearch, type useManagerLocation } from './installationsLocation'
import { useInstallationReview } from './useInstallationReview'
import styles from './InstallationsPage.module.css'

export const installationsKey = ['managers', 'installations']

type Props = ReturnType<typeof useManagerLocation> & {
  scope: string
  canWrite: boolean
  onExpired: () => void
  onForbidden: () => void
}

function ObservedTime({ value }: { value: string | null | undefined }) {
  return <time dateTime={value ?? undefined}>{formatTime(value)}</time>
}

function ReviewBadge({ row }: { row: Installation }) {
  return (
    <StatusBadge
      domain="installation_review"
      state={row.review.reviewed ? 'reviewed' : 'unreviewed'}
      calm
    />
  )
}

function InstallationDetails({ row, snapshot }: { row: Installation; snapshot: string }) {
  return (
    <section className={styles.accountCard} aria-labelledby={'installation-' + row.id}>
      <h2 id={'installation-' + row.id}>Аккаунт amoCRM {row.amo_account_id}</h2>
      <div className={styles.cardFacts}>
        <div>
          <h3>Установка</h3>
          <dl>
            <dt>ID аккаунта в Platform</dt>
            <dd className={styles.id}>{row.account_id}</dd>
            <dt>ID установки</dt>
            <dd className={styles.id}>{row.id}</dd>
            <dt>Продукт</dt>
            <dd>{row.product_name}</dd>
            <dt>{row.kind === 'observed' ? 'Источник' : 'Эпизод'}</dt>
            <dd>
              <StatusBadge domain="installation_kind" state={row.kind} calm />
              {row.kind === 'observed' ? null : ' № ' + row.generation}
            </dd>
            <dt>{row.kind === 'observed' ? 'Зарегистрирована в Core' : 'Установлена'}</dt>
            <dd>
              <ObservedTime value={row.installed_at} />
            </dd>
            <dt>Удалена</dt>
            <dd>
              <ObservedTime value={row.removed_at} />
            </dd>
            <dt>Последнее событие</dt>
            <dd>
              <StatusBadge domain="installation_event" state={row.last_lifecycle_event} calm />
            </dd>
            <dt>Состояние установки</dt>
            <dd>
              <StatusBadge domain="installation_lifecycle" state={row.lifecycle} calm />
            </dd>
            <dt>Авторизация amoCRM</dt>
            <dd>
              <StatusBadge domain="installation_authorization" state={row.authorization} calm />
            </dd>
            <dt>Активация</dt>
            <dd>
              <StatusBadge domain="installation_activation" state={row.activation_status} calm />
            </dd>
          </dl>
        </div>
        <div>
          <h3>Доступ к продукту</h3>
          <dl>
            <dt>Доступ</dt>
            <dd>
              <StatusBadge
                domain="product_access"
                state={row.access.active ? 'active' : 'inactive'}
                calm
              />
            </dd>
            <dt>Источник срока</dt>
            <dd>
              <StatusBadge domain="product_access_source" state={row.access.source} calm />
            </dd>
            <dt>Срок доступа</dt>
            <dd>
              {row.access.valid_until === null ? (
                'Нет даты'
              ) : (
                <ObservedTime value={row.access.valid_until} />
              )}
            </dd>
            <dt>Собственный срок</dt>
            <dd>
              {row.access.own_until === null ? (
                'Нет даты'
              ) : (
                <ObservedTime value={row.access.own_until} />
              )}
            </dd>
            <dt>Доступ рассчитан</dt>
            <dd>
              <ObservedTime value={row.access.computed_at} />
            </dd>
          </dl>
          <h3>Отметка проверки</h3>
          <dl>
            <dt>Состояние</dt>
            <dd>
              <ReviewBadge row={row} />
            </dd>
            <dt>ID проверившего</dt>
            <dd className={styles.id}>{row.review.reviewed_by ?? EMPTY}</dd>
            <dt>Проверена в</dt>
            <dd>
              <ObservedTime value={row.review.reviewed_at} />
            </dd>
          </dl>
        </div>
      </div>
      <p className={styles.provenance}>
        Platform · снимок на <ObservedTime value={snapshot} />
      </p>
    </section>
  )
}

export function InstallationsPage({
  search,
  updateFilters,
  navigate,
  scope,
  canWrite,
  onExpired,
  onForbidden,
}: Props) {
  const client = useQueryClient()
  const filters = getInstallationSearch(search)
  const searchKey = filters.toString()
  const [denied, setDenied] = useState(false)
  const [selection, setSelection] = useState<{ search: string; id: Installation['id'] } | null>(
    null,
  )

  function refresh() {
    if (getInstallationSearch(window.location.search).has('cursor')) {
      client.removeQueries({ queryKey: installationsKey, type: 'inactive' })
      updateFilters({ cursor: null }, true)
    } else {
      void client.invalidateQueries({ queryKey: installationsKey })
    }
  }

  const review = useInstallationReview({
    onAccessError(error) {
      if (isUnauthorized(error)) onExpired()
      else setDenied(true)
    },
    refresh,
  })

  const list = useQuery({
    queryKey: [...installationsKey, scope, searchKey],
    queryFn: ({ signal }) => listInstallations(searchKey, signal),
    enabled: !denied,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const unauthorized = isUnauthorized(list.error)
  const forbidden = denied || isForbidden(list.error)
  const { cancel } = review
  useEffect(() => {
    if (unauthorized) onExpired()
    if (forbidden) {
      cancel()
      setSelection(null)
      setDenied(true)
      client.removeQueries({ queryKey: installationsKey })
      onForbidden()
    }
  }, [cancel, client, forbidden, onExpired, onForbidden, unauthorized])

  const snapshot =
    list.isFetching || list.isError || list.isPaused || forbidden ? undefined : list.data
  const error = list.error
  const errorCode = isApiError(error) ? error.detailCode : undefined
  const lockReview = review.state.kind === 'checking' || review.state.kind === 'uncertain'
  const ascending = filters.get('sort') === 'installed_at'

  if (unauthorized) return null

  return (
    <section className={styles.page} aria-labelledby="installations-heading">
      <h1 id="installations-heading">Установки</h1>
      {forbidden ? (
        <p className={styles.message} role="alert">
          Нет доступа к установкам.
        </p>
      ) : (
        <>
          <InstallationFilters
            key={searchKey}
            filters={filters}
            apply={updateFilters}
            summary={snapshot?.summary}
          />
          {review.state.kind === 'checking' ? (
            <p className={styles.message} role="status">
              Проверяем результат изменения отметки…
            </p>
          ) : null}
          {review.state.kind === 'uncertain' ? (
            <div className={styles.message} role="alert">
              <StatusBadge domain="operation" state="unknown_outcome" />
              <button type="button" onClick={review.retry} disabled={review.retryBlocked}>
                Повторить запрос отметки
              </button>
              {review.retryBlocked ? (
                <span>Повтор станет доступен после паузы сервера.</span>
              ) : null}
            </div>
          ) : null}
          {review.state.kind === 'notice' ? (
            <p className={styles.message} role={review.state.error ? 'alert' : 'status'}>
              {review.state.message}
            </p>
          ) : null}
          {list.isFetching || (list.isPending && !list.isPaused) ? (
            <p className={styles.message} role="status">
              Загружаем установки…
            </p>
          ) : null}
          {!list.isFetching && (list.isError || list.isPaused) ? (
            <div className={styles.message} role="alert">
              {errorCode === 'invalid_cursor' ? (
                <>
                  <span>Снимок списка истёк или его параметры изменились.</span>
                  <button type="button" onClick={() => updateFilters({ cursor: null }, true)}>
                    В начало
                  </button>
                </>
              ) : errorCode === 'query_too_broad' ? (
                <span>Слишком много установок. Уточните фильтры.</span>
              ) : isApiError(error) && error.status === 400 ? (
                <span>Проверьте значения фильтров.</span>
              ) : (
                <>
                  <span>
                    {isApiError(error) && error.status === 429
                      ? 'Слишком много запросов.'
                      : 'Источник установок недоступен.'}
                  </span>
                  <button type="button" onClick={() => void list.refetch()}>
                    Повторить
                  </button>
                </>
              )}
            </div>
          ) : null}
          {snapshot ? (
            <>
              <div className={styles.results}>
                {snapshot.items.length === 0 ? (
                  <EmptyState title="Установки не найдены" />
                ) : (
                  <div
                    className={styles.tableScroll}
                    role="region"
                    aria-label="Список установок"
                    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Enable keyboard scrolling for all columns.
                    tabIndex={0}
                  >
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th scope="col" aria-sort={ascending ? 'ascending' : 'descending'}>
                            <button
                              className={styles.sortButton}
                              type="button"
                              onClick={() =>
                                updateFilters({
                                  sort: ascending ? '-installed_at' : 'installed_at',
                                  cursor: null,
                                })
                              }
                            >
                              Дата установки <span aria-hidden="true">{ascending ? '↑' : '↓'}</span>
                            </button>
                          </th>
                          <th scope="col">Виджет</th>
                          <th scope="col">ID amoCRM</th>
                          <th scope="col">Подробности</th>
                          <th scope="col">Проверка</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.items.map((row) => {
                          const selected =
                            selection?.search === searchKey && selection.id === row.id
                          return (
                            <Fragment key={row.id}>
                              <tr>
                                <td>
                                  <ObservedTime value={row.installed_at} />
                                  {row.kind === 'observed' ? <small>Импорт из Core</small> : null}
                                </td>
                                <td>
                                  <strong>{row.product_name}</strong>
                                  <small>{row.product_code}</small>
                                </td>
                                <td>
                                  <ManagerLink
                                    className={styles.accountLink}
                                    search={accountSearch(search, row.account_id)}
                                    navigate={navigate}
                                  >
                                    {row.amo_account_id}
                                  </ManagerLink>
                                </td>
                                <td>
                                  <StatusBadge
                                    domain="installation_lifecycle"
                                    state={row.lifecycle}
                                    calm
                                  />
                                  <br />
                                  <button
                                    type="button"
                                    className={styles.detailButton}
                                    aria-expanded={selected}
                                    onClick={() =>
                                      setSelection(
                                        selected ? null : { search: searchKey, id: row.id },
                                      )
                                    }
                                  >
                                    {selected ? 'Свернуть' : 'Подробнее'}
                                  </button>
                                </td>
                                <td>
                                  {row.kind === 'observed' ? (
                                    <span>История не подтверждена</span>
                                  ) : (
                                    <ReviewBadge row={row} />
                                  )}
                                  {row.review.reviewed_at ? (
                                    <small>
                                      <ObservedTime value={row.review.reviewed_at} />
                                    </small>
                                  ) : null}
                                  {canWrite && row.kind !== 'observed' ? (
                                    <button
                                      className={styles.reviewButton}
                                      data-variant={row.review.reviewed ? undefined : 'primary'}
                                      type="button"
                                      onClick={() => review.start(row)}
                                      disabled={lockReview}
                                    >
                                      {row.review.reviewed
                                        ? 'Снять отметку'
                                        : 'Отметить проверенной'}
                                    </button>
                                  ) : null}
                                </td>
                              </tr>
                              {selected ? (
                                <tr>
                                  <td className={styles.detailCell} colSpan={5}>
                                    <InstallationDetails
                                      row={row}
                                      snapshot={snapshot.source.observed_at}
                                    />
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <DataTablePager
                  rowCount={snapshot.items.length}
                  total={snapshot.summary.total}
                  nextCursor={snapshot.next_cursor}
                  onNext={() => updateFilters({ cursor: snapshot.next_cursor })}
                  onReset={() => updateFilters({ cursor: null })}
                  resetDisabled={!filters.has('cursor')}
                />
                <p className={styles.provenance}>
                  Platform ·{' '}
                  <StatusBadge domain="source" state={snapshot.source.status} variant="text" /> ·
                  Снимок на <ObservedTime value={snapshot.snapshot_at} />
                </p>
              </div>
            </>
          ) : null}
        </>
      )}
    </section>
  )
}
