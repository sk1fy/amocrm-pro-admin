import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { isApiError } from '../src/api/client'
import { formatTime } from '../src/lib/format'
import { accountSearch, ManagerLink } from './accountsLocation'
import { ReadFailure, useAccountAccessError, type AccountAccess } from './AccountsPage'
import { eventKinds, listEvents, type ManagerEvent, type TimelineScope } from './eventsApi'
import { productSearch } from './WidgetsPage'
import styles from './Accounts.module.css'
import timeline from './Timeline.module.css'
const filters = ['kind', 'product_id', 'from', 'to', 'limit', 'cursor', 'account_id']
export function eventQuery(search: string, context: TimelineScope) {
  const params = new URLSearchParams(search),
    query = new URLSearchParams()
  for (const key of filters) {
    if (key === 'account_id' && context.kind === 'history') continue
    for (const value of params.getAll(context.kind + '_' + key)) query.append(key, value)
  }
  return query
}
export function eventLinks(event: ManagerEvent, grants: string[], search: string) {
  if (!grants.includes('clients.read')) return []
  const parent = event.related_refs.find((ref) => ref.kind === 'account')
  return event.related_refs.flatMap((ref) => {
    if (ref.kind === 'account') {
      const params = new URLSearchParams(accountSearch(search, ref.id))
      params.set('section', 'clients')
      return [{ label: 'Аккаунт', search: params.toString() }]
    }
    if (ref.kind === 'product')
      return [{ label: 'Продукт', search: productSearch(search, { product: ref.id }) }]
    if (!parent) return []
    const params = new URLSearchParams(accountSearch(search, parent.id, 'widgets'))
    params.set('episode', ref.id)
    params.set('section', 'clients')
    return [{ label: 'Установка ' + ref.id, search: params.toString() }]
  })
}
export function Timeline({
  context,
  search,
  navigate,
  grants,
  scope,
  onExpired,
  onForbidden,
}: AccountAccess & {
  context: TimelineScope
  search: string
  navigate: (search: string) => void
  grants: string[]
}) {
  const cache = useQueryClient()
  const query = eventQuery(search, context),
    queryString = query.toString()
  const allowed = grants.includes(context.kind === 'feed' ? 'feed.read' : 'clients.read')
  const page = useQuery({
    queryKey: ['managers', 'timeline', scope, context, queryString],
    queryFn: ({ signal }) => listEvents(context, queryString, signal),
    enabled: allowed,
    retry: false,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })
  useAccountAccessError(page.error, onExpired, onForbidden)
  function change(values: URLSearchParams) {
    const params = new URLSearchParams(search)
    for (const key of filters) params.delete(context.kind + '_' + key)
    for (const [key, value] of values) if (value) params.append(context.kind + '_' + key, value)
    navigate(params.toString())
  }
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new URLSearchParams()
    for (const [key, value] of new FormData(event.currentTarget))
      if (typeof value === 'string' && value) values.append(key, value)
    change(values)
  }
  async function refresh() {
    const next = new URLSearchParams(query)
    next.delete('cursor')
    if (!query.has('cursor')) {
      await page.refetch()
      return
    }
    await cache
      .fetchQuery({
        queryKey: ['managers', 'timeline', scope, context, next.toString()],
        queryFn: ({ signal }) => listEvents(context, next.toString(), signal),
        staleTime: 0,
      })
      .catch(() => undefined)
    change(next)
  }

  if (!allowed)
    return <p role="alert">Нет доступа к {context.kind === 'feed' ? 'ленте' : 'истории'}.</p>
  const filterKey = new URLSearchParams(query)
  filterKey.delete('cursor')
  return (
    <section
      className={styles.workspace}
      aria-label={context.kind === 'feed' ? 'Лента событий' : 'История аккаунта'}
    >
      <header className={styles.toolbar}>
        <h1>{context.kind === 'feed' ? 'Лента событий' : 'История аккаунта'}</h1>
        <button type="button" onClick={() => void refresh()} disabled={page.isFetching}>
          Обновить события
        </button>
      </header>
      <form key={filterKey.toString()} className={styles.actions} onSubmit={apply}>
        <label>
          Виды событий
          <select name="kind" multiple defaultValue={query.getAll('kind')}>
            {Object.entries(eventKinds).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {context.kind === 'feed' ? (
          <label>
            ID аккаунта
            <input name="account_id" defaultValue={query.get('account_id') ?? ''} />
          </label>
        ) : null}
        <label>
          ID продукта
          <input name="product_id" defaultValue={query.get('product_id') ?? ''} />
        </label>
        <label>
          С (Москва)
          <input type="date" name="from" defaultValue={query.get('from') ?? ''} />
        </label>
        <label>
          По (Москва)
          <input type="date" name="to" defaultValue={query.get('to') ?? ''} />
        </label>
        <button type="submit">Применить</button>
        <button type="button" onClick={() => change(new URLSearchParams())}>
          Сбросить
        </button>
      </form>
      {page.isFetching ? <p role="status">Загружаем события…</p> : null}
      {page.isError ? (
        query.has('cursor') &&
        isApiError(page.error) &&
        (page.error.code === 'invalid_cursor' || page.error.detailCode === 'invalid_cursor') ? (
          <div role="alert">
            Снимок недействителен.{' '}
            <button type="button" onClick={() => void refresh()}>
              Начать с первой страницы
            </button>
          </div>
        ) : isApiError(page.error) && page.error.status === 429 ? (
          <div role="alert">
            Источник ограничил запросы.{' '}
            <button type="button" onClick={() => void page.refetch()}>
              Повторить
            </button>
          </div>
        ) : (
          <ReadFailure error={page.error} retry={() => void page.refetch()} />
        )
      ) : page.data ? (
        <>
          <p className={styles.meta}>Platform · снимок на {formatTime(page.data.snapshot_at)}</p>
          {page.data.items.length === 0 ? (
            <p>Событий по выбранным условиям нет.</p>
          ) : (
            <ol className={timeline.list}>
              {page.data.items.map((event) => (
                <li key={event.id} className={timeline.row}>
                  <div className={timeline.event}>
                    <strong>{eventKinds[event.kind]}</strong>
                    <p>{event.summary}</p>
                    <p className={styles.meta}>{event.actor_display ?? 'Исполнитель не указан'}</p>
                    <p className={styles.meta}>
                      ID события {event.id} · записано {formatTime(event.recorded_at)}
                    </p>
                    <div className={styles.actions}>
                      {eventLinks(event, grants, search).map((link) => (
                        <ManagerLink key={link.search} search={link.search} navigate={navigate}>
                          {link.label}
                        </ManagerLink>
                      ))}
                    </div>
                  </div>
                  <time className={styles.meta} dateTime={event.occurred_at}>
                    {formatTime(event.occurred_at)}
                  </time>
                </li>
              ))}
            </ol>
          )}
          {page.data.next_cursor ? (
            <button
              type="button"
              onClick={() => {
                const next = new URLSearchParams(query)
                next.set('cursor', page.data.next_cursor ?? '')
                change(next)
              }}
            >
              Следующая страница
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
