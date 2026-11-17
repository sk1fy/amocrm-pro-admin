import { useQuery } from '@tanstack/react-query'
import { useEffect, type FormEvent } from 'react'
import { isApiError } from '../src/api/client'
import { StatusBadge } from '../src/components/StatusBadge'
import { formatTime } from '../src/lib/format'
import { listAccounts } from './accountsApi'
import {
  accountSearch,
  getAccountSearch,
  ManagerLink,
  ratingField,
  updateAccountSearch,
} from './accountsLocation'
import styles from './Accounts.module.css'

export const accountsKey = ['managers', 'accounts']

export type AccountAccess = {
  scope: string
  onExpired: () => void
  onForbidden: () => void
}

export function useAccountAccessError(
  error: unknown,
  onExpired: () => void,
  onForbidden: () => void,
) {
  useEffect(() => {
    if (!isApiError(error)) return
    if (error.status === 401) onExpired()
    if (error.status === 403) onForbidden()
  }, [error, onExpired, onForbidden])
}

export function ReadFailure({ error, retry }: { error: unknown; retry: () => void }) {
  const status = isApiError(error) ? error.status : 0
  return (
    <div className={styles.actions} role="alert">
      <span>
        {status === 403
          ? 'Нет доступа'
          : status === 404
            ? 'Запись не найдена'
            : status === 400
              ? 'Проверьте параметры запроса'
              : 'Источник недоступен'}
      </span>
      {status !== 403 && status !== 404 ? (
        <button type="button" onClick={retry}>
          Повторить
        </button>
      ) : null}
    </div>
  )
}

export function AccountsPage({
  search,
  navigate,
  scope,
  onExpired,
  onForbidden,
}: AccountAccess & {
  search: string
  navigate: (search: string) => void
}) {
  const { query: params, filter, invalid } = getAccountSearch(search)
  const queryString = params.toString()
  const page = useQuery({
    queryKey: [...accountsKey, scope, queryString, filter],
    queryFn: ({ signal }) => listAccounts(queryString, filter, signal),
    enabled: !invalid,
    retry: false,
  })
  useAccountAccessError(page.error, onExpired, onForbidden)
  const invalidCursor =
    Boolean(params.get('cursor')) && isApiError(page.error) && page.error.status === 400
  const filterKey = new URLSearchParams(params)
  filterKey.delete('cursor')

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const value = (name: string) => String(form.get(name) ?? '')
    const rating = value('rating')
    const portfolio =
      rating === ''
        ? filter
        : rating === 'clear'
          ? null
          : JSON.stringify({
              condition: { field_id: ratingField, op: 'gte', value: Number(rating) },
            })
    navigate(
      updateAccountSearch(search, {
        q: value('q').trim(),
        classification: form.getAll('classification').map(String),
        sort: value('sort'),
        product_id: value('product_id').trim(),
        active_users_min: value('active_users_min'),
        active_users_max: value('active_users_max'),
        limit: value('limit'),
        portrait: portfolio,
        cursor: null,
      }),
    )
  }

  return (
    <section className={styles.workspace}>
      <h1>Клиенты</h1>
      <form className={styles.form} key={filterKey.toString() + (filter ?? '')} onSubmit={apply}>
        <div className={styles.filters}>
          <label>
            Поиск
            <input
              name="q"
              type="search"
              defaultValue={params.get('q') ?? ''}
              placeholder="Название, домен или ID"
            />
          </label>
          <label>
            Классификация
            <select name="classification" multiple defaultValue={params.getAll('classification')}>
              <option>Без партнёра</option>
              <option>Запрет работы</option>
            </select>
          </label>
          <label>
            Сортировка
            <select name="sort" defaultValue={params.get('sort') ?? ''}>
              <option value="">По умолчанию</option>
              <option value="amo_account_id">ID amoCRM</option>
              <option value="current_domain">Домен</option>
              <option value="display_name">Название</option>
            </select>
          </label>
          <label>
            ID продукта
            <input
              name="product_id"
              defaultValue={params.get('product_id') ?? ''}
              pattern="[0-9a-fA-F-]{36}"
            />
          </label>
          <label>
            Активных пользователей от
            <input
              name="active_users_min"
              type="number"
              min="0"
              defaultValue={params.get('active_users_min') ?? ''}
            />
          </label>
          <label>
            Активных пользователей до
            <input
              name="active_users_max"
              type="number"
              min="0"
              defaultValue={params.get('active_users_max') ?? ''}
            />
          </label>
          <label>
            Фильтр портрета
            <select name="rating">
              <option value="">{filter ? 'Сохранить текущий фильтр' : 'Все рейтинги'}</option>
              {filter ? <option value="clear">Сбросить фильтр портрета</option> : null}
              {[0, 1, 2, 3, 4, 5].map((rating) => (
                <option value={rating} key={rating}>
                  Рейтинг от {rating}
                </option>
              ))}
            </select>
          </label>
          <label>
            Строк на странице
            <input
              name="limit"
              type="number"
              min="1"
              max="100"
              defaultValue={params.get('limit') ?? '25'}
            />
          </label>
        </div>
        <div className={styles.actions}>
          <button type="submit">Применить фильтры</button>
        </div>
      </form>
      {invalid ? (
        <div role="alert">
          Некорректный фильтр портрета.{' '}
          <button
            type="button"
            onClick={() => navigate(updateAccountSearch(search, { portrait: null, cursor: null }))}
          >
            Сбросить фильтр
          </button>
        </div>
      ) : page.isPending ? (
        <p role="status">Загружаем клиентов…</p>
      ) : page.isError ? (
        invalidCursor ? (
          <div role="alert">
            Курсор недействителен.{' '}
            <button
              type="button"
              onClick={() => navigate(updateAccountSearch(search, { cursor: null }))}
            >
              Первая страница
            </button>
          </div>
        ) : (
          <ReadFailure error={page.error} retry={() => void page.refetch()} />
        )
      ) : (
        <div className={styles.results}>
          <p>
            Найдено <strong>{page.data.total}</strong>
          </p>
          <p className={styles.meta}>Platform · снимок на {formatTime(page.data.snapshot_at)}</p>
          {page.data.items.length === 0 ? (
            <p>Клиенты не найдены</p>
          ) : (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Клиент</th>
                    <th scope="col">Домен</th>
                    <th scope="col">Классификация</th>
                    <th scope="col">Наши продукты</th>
                    <th scope="col">Активные пользователи</th>
                  </tr>
                </thead>
                <tbody>
                  {page.data.items.map((account) => (
                    <tr key={account.account_id}>
                      <td>
                        <ManagerLink
                          search={accountSearch(search, account.account_id)}
                          navigate={navigate}
                        >
                          {account.display_name ?? account.amo_account_id}
                        </ManagerLink>
                      </td>
                      <td>{account.current_domain ?? '—'}</td>
                      <td>{account.classification ?? '—'}</td>
                      <td>{account.active_products_count}</td>
                      <td>
                        {account.active_users.value ?? '—'}{' '}
                        {account.active_users.state !== 'fresh' ? (
                          <StatusBadge domain="freshness" state={account.active_users.state} calm />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className={styles.actions}>
            {params.has('cursor') ? (
              <button
                type="button"
                onClick={() => navigate(updateAccountSearch(search, { cursor: null }))}
              >
                Первая страница
              </button>
            ) : null}
            {page.data.next_cursor ? (
              <button
                type="button"
                onClick={() =>
                  navigate(updateAccountSearch(search, { cursor: page.data.next_cursor }))
                }
              >
                Следующая страница
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}
