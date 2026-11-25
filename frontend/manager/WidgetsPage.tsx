import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { isApiError } from '../src/api/client'
import { formatTime } from '../src/lib/format'
import { ManagerLink } from './accountsLocation'
import { ReadFailure, useAccountAccessError, type AccountAccess } from './AccountsPage'
import { WidgetSettings } from './WidgetSettings'
import {
  WidgetConnectionProblems,
  WidgetFilters,
  WidgetSummary,
  WidgetTable,
} from './WidgetsCatalog'
import {
  getProduct,
  getProductMetrics,
  isProductId,
  listProducts,
  type Product,
  type ProductId,
} from './productsApi'
import styles from './Accounts.module.css'
import catalogStyles from './WidgetsCatalog.module.css'
import settingsStyles from './WidgetSettings.module.css'

export const productsKey = ['managers', 'products']
export function productSearch(search: string, updates: Record<string, string | null>) {
  const params = new URLSearchParams(search)
  for (const [key, value] of Object.entries(updates)) {
    if (value) params.set(key, value)
    else params.delete(key)
  }
  for (const key of ['account', 'widget_cursor', 'list_tab', 'tab']) params.delete(key)
  params.set('section', 'widgets')
  return params.toString()
}
export function productQuery(search: string) {
  const params = new URLSearchParams(search),
    query = new URLSearchParams()
  for (const key of ['q', 'line', 'availability', 'limit', 'cursor', 'sort', 'attention']) {
    const value = params.get('products_' + key)
    if (value) query.set(key, value)
  }
  return query
}

export function WidgetsPage({
  search,
  navigate,
  grants,
  technicalControls,
  ...access
}: AccountAccess & {
  search: string
  navigate: (search: string, replace?: boolean) => void
  technicalControls: boolean
  grants: string[]
}) {
  const params = new URLSearchParams(search),
    selected = params.get('product')
  const id = isProductId(selected) ? selected : null
  const creating = params.get('product_new') === '1'
  const dialogSelection = creating ? 'new' : selected
  const canRead = grants.includes('catalog.read'),
    canWrite = grants.includes('catalog.manage'),
    canStats = grants.includes('stats.read')
  const canOverview = canStats && grants.includes('clients.read')
  const query = productQuery(search)
  if (canOverview) {
    query.set('overview', 'true')
  } else {
    query.delete('sort')
    query.delete('attention')
  }
  const queryString = query.toString()
  const client = useQueryClient()
  const [saved, setSaved] = useState<Product | null>(null)
  const openedFromCatalog = useRef<string | null>(null)
  const list = useQuery({
    queryKey: [...productsKey, access.scope, queryString],
    queryFn: ({ signal }) => listProducts(queryString, signal),
    enabled: canRead,
    placeholderData: keepPreviousData,
    retry: false,
  })
  const detail = useQuery({
    queryKey: [...productsKey, access.scope, 'detail', id],
    queryFn: ({ signal }) => {
      if (!id) throw new Error('product missing')
      return getProduct(id, signal)
    },
    enabled: canRead && Boolean(id) && !creating,
    retry: false,
  })
  useAccountAccessError(list.error, access.onExpired, access.onForbidden)
  useAccountAccessError(detail.error, access.onExpired, access.onForbidden)
  const product = detail.isError
    ? undefined
    : saved?.id === id && (!detail.data || saved.version > detail.data.version)
      ? saved
      : detail.data
  const save = (value?: Product) => {
    if (value) {
      setSaved(value)
      client.setQueryData([...productsKey, access.scope, 'detail', value.id], value)
      if (creating) {
        if (openedFromCatalog.current === 'new') openedFromCatalog.current = value.id
        navigate(productSearch(search, { product: value.id, product_new: null }), true)
      }
    }
    void client.invalidateQueries({ queryKey: productsKey })
  }
  const apply = useCallback(
    (updates: Record<string, string | null>) => {
      if (selected || creating) return
      const filters: Record<string, string | null> = { products_cursor: null }
      for (const [key, value] of Object.entries(updates)) filters['products_' + key] = value
      const next = productSearch(search, filters)
      if (next !== new URLSearchParams(search).toString()) navigate(next)
    },
    [search, navigate, selected, creating],
  )
  const productLocation = (product: ProductId) => productSearch(search, { product })
  function openProduct(next: string) {
    openedFromCatalog.current = new URLSearchParams(next).get('product') ?? 'new'
    navigate(next)
  }
  function closeProduct() {
    if (dialogSelection && openedFromCatalog.current === dialogSelection) {
      window.history.back()
    } else {
      navigate(
        productSearch(search, {
          product: null,
          product_new: null,
          metrics_from: null,
          metrics_to: null,
        }),
        true,
      )
    }
  }
  const cursorExpired = query.has('cursor') && isApiError(list.error) && list.error.status === 400
  function firstPage() {
    navigate(productSearch(search, { products_cursor: null }))
  }
  return (
    <section className={styles.workspace + ' ' + catalogStyles.directory}>
      <div className={catalogStyles.heading}>
        <div>
          <h1>Виджеты</h1>
          {canRead ? (
            <p className={styles.meta}>
              {canOverview && (
                <>
                  График показывает установки по месяцам за год.
                  <br />
                </>
              )}
              Нажмите на строку, чтобы открыть настройки виджета.
            </p>
          ) : null}
        </div>
        <div className={catalogStyles.headingActions}>
          {canWrite ? (
            <ManagerLink
              search={productSearch(search, { product: null, product_new: '1' })}
              navigate={openProduct}
              className={catalogStyles.create}
            >
              Новый виджет
            </ManagerLink>
          ) : null}
          {list.data && !list.isPlaceholderData ? (
            <p className={styles.meta}>
              Platform ·{' '}
              <time dateTime={list.data.snapshot_at}>{formatTime(list.data.snapshot_at)}</time>
            </p>
          ) : null}
        </div>
      </div>
      {!canRead ? (
        <p role="alert">
          Нет доступа к списку виджетов.
          {technicalControls && canStats && !selected
            ? ' Откройте прямую ссылку на метрики виджета.'
            : ''}
        </p>
      ) : (
        <>
          {list.data?.overview ? <WidgetSummary summary={list.data.overview.summary} /> : null}
          <WidgetFilters
            query={query}
            canStats={canOverview}
            summary={list.data?.overview?.summary}
            apply={apply}
          />
          {list.isPending || list.isPlaceholderData ? (
            <p role="status">Загружаем виджеты…</p>
          ) : !list.data ? (
            cursorExpired ? (
              <div role="alert">
                Каталог изменился или курсор недействителен.{' '}
                <button onClick={firstPage}>Первая страница</button>
              </div>
            ) : (
              <ReadFailure error={list.error} retry={() => void list.refetch()} />
            )
          ) : (
            <div className={styles.results + ' ' + catalogStyles.results}>
              {list.data.items.length === 0 ? (
                <p>Виджеты не найдены</p>
              ) : (
                <WidgetTable
                  products={list.data.items}
                  statistics={list.data.overview?.statistics}
                  showStats={Boolean(list.data.overview)}
                  navigate={openProduct}
                  productLocation={productLocation}
                />
              )}
              <div className={styles.actions}>
                {query.has('cursor') ? <button onClick={firstPage}>Первая страница</button> : null}
                {list.data.next_cursor && !cursorExpired ? (
                  <button
                    onClick={() =>
                      navigate(productSearch(search, { products_cursor: list.data.next_cursor }))
                    }
                  >
                    Следующая страница
                  </button>
                ) : null}
                <label>
                  Строк на странице{' '}
                  <select
                    value={query.get('limit') ?? '25'}
                    onChange={(event) => apply({ limit: event.target.value })}
                  >
                    {[...new Set([10, 25, 50, 100, Number(query.get('limit') ?? '25')])]
                      .sort((a, b) => a - b)
                      .filter((limit) => Number.isInteger(limit) && limit >= 1 && limit <= 100)
                      .map((limit) => (
                        <option key={limit}>{limit}</option>
                      ))}
                  </select>
                </label>
              </div>
              {list.isError ? (
                <div role="alert">
                  Показан предыдущий снимок каталога.{' '}
                  {cursorExpired ? (
                    'Каталог изменился. Перейдите на первую страницу, чтобы увидеть новые данные.'
                  ) : (
                    <button onClick={() => void list.refetch()}>Повторить загрузку</button>
                  )}
                </div>
              ) : null}
              {list.data.overview ? (
                <WidgetConnectionProblems
                  overview={list.data.overview}
                  search={search}
                  productLocation={productLocation}
                  navigate={openProduct}
                />
              ) : null}
            </div>
          )}
        </>
      )}
      {creating && !canWrite ? <p role="alert">Нет права на изменение каталога.</p> : null}
      {dialogSelection && (!creating || canWrite) ? (
        <WidgetSettings
          key={dialogSelection}
          creating={creating}
          selection={dialogSelection}
          technicalControls={technicalControls && (canRead || canStats || canWrite)}
          product={creating ? undefined : product}
          canWrite={canWrite}
          {...access}
          onSaved={save}
          onClose={closeProduct}
          metrics={
            !creating && id && canStats ? (
              canRead || product ? (
                <details
                  className={settingsStyles.details}
                  open={params.has('metrics_from') || params.has('metrics_to')}
                >
                  <summary>Метрики виджета</summary>
                  <ProductMetrics
                    id={id}
                    search={search}
                    navigate={navigate}
                    {...access}
                    embedded
                  />
                </details>
              ) : (
                <ProductMetrics id={id} search={search} navigate={navigate} {...access} />
              )
            ) : null
          }
        >
          {creating ? null : !id ? (
            <p role="alert">Некорректный идентификатор виджета.</p>
          ) : (
            <>
              {canRead ? (
                detail.isPending && !product ? (
                  <p role="status">Загружаем виджет…</p>
                ) : detail.isError ? (
                  <ReadFailure error={detail.error} retry={() => void detail.refetch()} />
                ) : null
              ) : !product ? (
                <p>Нет доступа к карточке каталога.</p>
              ) : null}
            </>
          )}
        </WidgetSettings>
      ) : null}
    </section>
  )
}

function ProductMetrics({
  id,
  search,
  navigate,
  embedded,
  ...access
}: AccountAccess & {
  id: ProductId
  search: string
  navigate: (search: string, replace?: boolean) => void
  embedded?: boolean
}) {
  const params = new URLSearchParams(search),
    query = new URLSearchParams()
  for (const key of ['from', 'to']) {
    const value = params.get('metrics_' + key)
    if (value) query.set(key, value)
  }
  const queryString = query.toString()
  const metrics = useQuery({
    queryKey: [...productsKey, access.scope, 'metrics', id, queryString],
    queryFn: ({ signal }) => getProductMetrics(id, queryString, signal),
    retry: false,
  })
  useAccountAccessError(metrics.error, access.onExpired, access.onForbidden)
  return (
    <section className={styles.panel} aria-label="Метрики виджета">
      {embedded ? null : <h2>Метрики виджета</h2>}
      <form
        className={styles.form}
        key={queryString}
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          navigate(
            productSearch(search, {
              metrics_from: String(form.get('from') ?? ''),
              metrics_to: String(form.get('to') ?? ''),
            }),
            true,
          )
        }}
      >
        <div className={styles.filters}>
          <label>
            Установки с<input type="date" name="from" defaultValue={query.get('from') ?? ''} />
          </label>
          <label>
            Установки по
            <input type="date" name="to" defaultValue={query.get('to') ?? ''} />
          </label>
        </div>
        <button>Применить период</button>
      </form>
      {metrics.isPending ? (
        <p role="status">Загружаем метрики…</p>
      ) : metrics.isError ? (
        <ReadFailure error={metrics.error} retry={() => void metrics.refetch()} />
      ) : (
        <>
          <dl className={styles.facts}>
            <dt>Подтверждённые установки за период</dt>
            <dd>{metrics.data.confirmed_installations}</dd>
            <dt>Текущие активные доступы</dt>
            <dd>{metrics.data.active_accesses}</dd>
            <dt>Записанные активации</dt>
            <dd>{metrics.data.activations}</dd>
          </dl>
          <p className={styles.meta}>
            Установки считают подтверждённые эпизоды, включая повторные установки. Последний день
            включён. Активные доступы показаны на текущий снимок и не зависят от периода.
          </p>
          <p className={styles.meta}>
            Активации считаются по записям формы для установок выбранного периода.
          </p>
          <p className={styles.meta}>Platform · снимок на {formatTime(metrics.data.snapshot_at)}</p>
        </>
      )}
    </section>
  )
}
