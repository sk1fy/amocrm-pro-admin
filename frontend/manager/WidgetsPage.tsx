import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { StatusBadge } from '../src/components/StatusBadge'
import { isApiError } from '../src/api/client'
import { formatTime } from '../src/lib/format'
import { ManagerLink } from './accountsLocation'
import { ReadFailure, useAccountAccessError, type AccountAccess } from './AccountsPage'
import { ProductEditor } from './ProductEditor'
import {
  getProduct,
  getProductMetrics,
  isProductId,
  listProducts,
  type Product,
  type ProductId,
} from './productsApi'
import styles from './Accounts.module.css'

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
  for (const key of ['q', 'line', 'availability', 'limit', 'cursor']) {
    const value = params.get('products_' + key)
    if (value) query.set(key, value)
  }
  return query
}

export function WidgetsPage({
  search,
  navigate,
  grants,
  ...access
}: AccountAccess & { search: string; navigate: (search: string) => void; grants: string[] }) {
  const params = new URLSearchParams(search),
    selected = params.get('product')
  const id = isProductId(selected) ? selected : null
  const creating = params.get('product_new') === '1'
  const canRead = grants.includes('clients.read'),
    canWrite = grants.includes('catalog.manage'),
    canStats = grants.includes('stats.read')
  const query = productQuery(search),
    queryString = query.toString()
  const client = useQueryClient()
  const [saved, setSaved] = useState<Product | null>(null)
  const list = useQuery({
    queryKey: [...productsKey, access.scope, queryString],
    queryFn: ({ signal }) => listProducts(queryString, signal),
    enabled: canRead && !selected && !creating,
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
      navigate(productSearch(search, { product: value.id, product_new: null }))
    }
    void client.invalidateQueries({ queryKey: productsKey })
  }
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const updates: Record<string, string | null> = { products_cursor: null }
    for (const key of ['q', 'line', 'availability', 'limit'])
      updates['products_' + key] = String(form.get(key) ?? '')
    navigate(productSearch(search, updates))
  }
  return (
    <section className={styles.workspace}>
      <div className={styles.heading}>
        <h1>{product?.display_name ?? 'Виджеты'}</h1>
        <div className={styles.actions}>
          {(id || creating) && canRead ? (
            <ManagerLink
              search={productSearch(search, { product: null, product_new: null })}
              navigate={navigate}
            >
              Все виджеты
            </ManagerLink>
          ) : null}
          {canWrite && !creating ? (
            <ManagerLink
              search={productSearch(search, { product: null, product_new: '1' })}
              navigate={navigate}
            >
              Новый виджет
            </ManagerLink>
          ) : null}
        </div>
      </div>
      {creating ? (
        canWrite ? (
          <ProductEditor key="new" {...access} onSaved={save} />
        ) : (
          <p role="alert">Нет права на изменение каталога.</p>
        )
      ) : id ? (
        <>
          {canRead ? (
            detail.isPending ? (
              <p role="status">Загружаем виджет…</p>
            ) : detail.isError ? (
              <ReadFailure error={detail.error} retry={() => void detail.refetch()} />
            ) : null
          ) : !product ? (
            <p>Нет доступа к карточке каталога.</p>
          ) : null}
          {product ? (
            <>
              <section className={styles.panel} aria-label="Карточка виджета">
                <dl className={styles.facts}>
                  <dt>Код</dt>
                  <dd>{product.code}</dd>
                  <dt>Линейка</dt>
                  <dd>{product.line}</dd>
                  <dt>Доступность</dt>
                  <dd>
                    <StatusBadge domain="product_availability" state={product.availability} calm />
                  </dd>
                  <dt>Пробный период</dt>
                  <dd>
                    <StatusBadge domain="product_trial" state={product.trial_policy.kind} calm />
                    {product.trial_policy.duration_days === null
                      ? null
                      : ' · ' + product.trial_policy.duration_days + ' дней'}
                  </dd>
                  <dt>Версия карточки</dt>
                  <dd>{product.version}</dd>
                  <dt>Версия тарифа</dt>
                  <dd>{product.tariff_version ?? '—'}</dd>
                  <dt>Интеграции</dt>
                  <dd>{product.integration_refs.join(', ') || '—'}</dd>
                  <dt>Ссылки</dt>
                  <dd>
                    {product.links.map((l) => (
                      <p key={l.url}>
                        <a href={l.url} target="_blank" rel="noreferrer">
                          {l.label}
                        </a>
                      </p>
                    ))}
                  </dd>
                </dl>
              </section>
              {canWrite ? (
                <ProductEditor key={id} {...access} product={product} onSaved={save} />
              ) : (
                <p>Каталог доступен только для чтения.</p>
              )}
            </>
          ) : null}
          {canStats ? (
            <ProductMetrics key={id} id={id} search={search} navigate={navigate} {...access} />
          ) : (
            <p>Нет доступа к метрикам.</p>
          )}
        </>
      ) : selected ? (
        <p role="alert">Некорректный идентификатор виджета.</p>
      ) : !canRead ? (
        <p role="alert">
          Нет доступа к списку виджетов.
          {canStats ? ' Откройте прямую ссылку на метрики виджета.' : ''}
        </p>
      ) : (
        <>
          <form className={styles.form} key={queryString} onSubmit={apply}>
            <div className={styles.filters}>
              <label>
                Поиск виджетов
                <input name="q" type="search" defaultValue={query.get('q') ?? ''} />
              </label>
              <label>
                Линейка
                <select name="line" defaultValue={query.get('line') ?? ''}>
                  <option value="">Все</option>
                  {['FREE', 'TOP', 'PRO'].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
              <label>
                Доступность
                <select name="availability" defaultValue={query.get('availability') ?? ''}>
                  <option value="">Все</option>
                  <option value="draft">Черновик</option>
                  <option value="pilot">Пилот</option>
                  <option value="active">Доступен</option>
                  <option value="archived">Архив</option>
                </select>
              </label>
              <label>
                Строк на странице
                <input
                  name="limit"
                  type="number"
                  min="1"
                  max="100"
                  defaultValue={query.get('limit') ?? '25'}
                />
              </label>
            </div>
            <button>Применить фильтры</button>
          </form>
          {list.isPending ? (
            <p role="status">Загружаем виджеты…</p>
          ) : list.isError ? (
            query.has('cursor') && isApiError(list.error) && list.error.status === 400 ? (
              <div role="alert">
                Каталог изменился или курсор недействителен.{' '}
                <button onClick={() => navigate(productSearch(search, { products_cursor: null }))}>
                  Первая страница
                </button>
              </div>
            ) : (
              <ReadFailure error={list.error} retry={() => void list.refetch()} />
            )
          ) : (
            <div className={styles.results}>
              <p className={styles.meta}>
                Platform · снимок на {formatTime(list.data.snapshot_at)}
              </p>
              {list.data.items.length === 0 ? (
                <p>Виджеты не найдены</p>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Виджет</th>
                      <th scope="col">Код</th>
                      <th scope="col">Линейка</th>
                      <th scope="col">Доступность</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.items.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <ManagerLink
                            search={productSearch(search, { product: row.id })}
                            navigate={navigate}
                          >
                            {row.display_name}
                          </ManagerLink>
                        </td>
                        <td>{row.code}</td>
                        <td>{row.line}</td>
                        <td>
                          <StatusBadge
                            domain="product_availability"
                            state={row.availability}
                            calm
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className={styles.actions}>
                {query.has('cursor') ? (
                  <button
                    onClick={() => navigate(productSearch(search, { products_cursor: null }))}
                  >
                    Первая страница
                  </button>
                ) : null}
                {list.data.next_cursor ? (
                  <button
                    onClick={() =>
                      navigate(productSearch(search, { products_cursor: list.data.next_cursor }))
                    }
                  >
                    Следующая страница
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function ProductMetrics({
  id,
  search,
  navigate,
  ...access
}: AccountAccess & { id: ProductId; search: string; navigate: (search: string) => void }) {
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
      <h2>Метрики виджета</h2>
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
            Источник активаций G03 пока не подключён. Ноль означает отсутствие записанных событий, а
            не подтверждённое отсутствие активаций.
          </p>
          <p className={styles.meta}>Platform · снимок на {formatTime(metrics.data.snapshot_at)}</p>
        </>
      )}
    </section>
  )
}
