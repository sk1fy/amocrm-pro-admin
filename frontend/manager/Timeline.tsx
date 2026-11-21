import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { isApiError } from '../src/api/client'
import { accountSearch, ManagerLink } from './accountsLocation'
import { ReadFailure, useAccountAccessError, type AccountAccess } from './AccountsPage'
import { FeedEvent, FeedFilters, formatFeedTime } from './EventFeed'
import { eventKinds, listEvents, type ManagerEvent, type TimelineScope } from './eventsApi'
import { productSearch } from './WidgetsPage'
import styles from './Accounts.module.css'
import timeline from './Timeline.module.css'
import card from './AccountCard.module.css'
const filters = ['kind', 'product_id', 'from', 'to', 'limit', 'cursor', 'account_id']
const historyGroups: { label: string; kinds: ManagerEvent['kind'][] }[] = [
  { label: 'Всё', kinds: [] },
  {
    label: 'Установки',
    kinds: ['installed', 'reinstalled', 'reauthorized', 'uninstalled', 'activated'],
  },
  { label: 'Продления', kinds: ['access_renewed'] },
  {
    label: 'Правки',
    kinds: [
      'installation_reviewed',
      'installation_unreviewed',
      'account_profile_updated',
      'portrait_updated',
    ],
  },
]
const historyDate = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeZone: 'Europe/Moscow',
})
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
      return grants.includes('catalog.read')
        ? [{ label: 'Продукт', search: productSearch(search, { product: ref.id }) }]
        : []
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
  const history = context.kind === 'history'
  const allowed = grants.includes(history ? 'clients.read' : 'feed.read')
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
    const firstPage = next.toString()
    const request = cache.fetchQuery({
      queryKey: ['managers', 'timeline', scope, context, firstPage],
      queryFn: ({ signal }) => listEvents(context, firstPage, signal),
      staleTime: 0,
    })
    change(next)
    await request.catch(() => undefined)
  }

  if (!allowed)
    return <p role="alert">Нет доступа к {context.kind === 'feed' ? 'ленте' : 'истории'}.</p>
  const filterKey = new URLSearchParams(query)
  filterKey.delete('cursor')
  const selectedKinds = new Set(query.getAll('kind'))
  const selectedGroup = historyGroups.find(
    ({ kinds }) =>
      selectedKinds.size === kinds.length && kinds.every((kind) => selectedKinds.has(kind)),
  )
  const extraFilters =
    ['product_id', 'from', 'to'].filter((key) => query.has(key)).length +
    Number(selectedGroup === undefined)
  return (
    <section
      className={history ? card.surface : styles.workspace}
      aria-label={history ? 'История аккаунта' : 'Лента событий'}
    >
      <header className={history ? card.sectionHeader : timeline.feedHeader}>
        {history ? (
          <div className={timeline.historyHeading}>
            <h2>История аккаунта</h2>
            <span>Установки, продления и изменения профиля</span>
          </div>
        ) : (
          <div className={timeline.feedHeading}>
            <h1>Лента событий</h1>
            <p>Установки, авторизации, продления и другие события по аккаунтам</p>
          </div>
        )}
        <button type="button" onClick={() => void refresh()} disabled={page.isFetching}>
          Обновить события
        </button>
      </header>
      {history ? (
        <div className={timeline.historyToolbar}>
          <div className={timeline.historyGroups} role="group" aria-label="Группы событий истории">
            {historyGroups.map(({ label, kinds }) => (
              <button
                key={label}
                type="button"
                aria-pressed={selectedGroup?.label === label}
                onClick={() => {
                  const next = new URLSearchParams(filterKey)
                  next.delete('kind')
                  for (const kind of kinds) next.append('kind', kind)
                  change(next)
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <details className={timeline.historyOptions}>
            <summary>{extraFilters ? 'Фильтры · ' + extraFilters : 'Фильтры'}</summary>
            <form key={filterKey.toString()} className={timeline.historyFilters} onSubmit={apply}>
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
              {query.has('limit') && (
                <input type="hidden" name="limit" value={query.get('limit') ?? ''} />
              )}
              <button type="submit">Применить</button>
              <button type="button" onClick={() => change(new URLSearchParams())}>
                Сбросить
              </button>
            </form>
          </details>
        </div>
      ) : (
        <FeedFilters
          key={filterKey.toString()}
          query={query}
          apply={apply}
          reset={() => change(new URLSearchParams())}
        />
      )}
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
          <p className={history ? timeline.historyMeta : timeline.feedMeta}>
            Platform · снимок на {formatFeedTime(page.data.snapshot_at)} МСК
          </p>
          {page.data.items.length === 0 ? (
            <p className={history ? card.empty : undefined}>Событий по выбранным условиям нет.</p>
          ) : history ? (
            <div className={card.tableScroll}>
              <table className={`${styles.table} ${timeline.historyTable}`}>
                <thead>
                  <tr>
                    <th scope="col">Дата</th>
                    <th scope="col">Событие</th>
                    <th scope="col">Виджет</th>
                    <th scope="col">Подробности</th>
                    <th scope="col">Исполнитель</th>
                  </tr>
                </thead>
                <tbody>
                  {page.data.items.map((event) => (
                    <tr key={event.id}>
                      <td>
                        <time
                          dateTime={event.occurred_at}
                          title={formatFeedTime(event.occurred_at) + ' МСК'}
                        >
                          {historyDate.format(new Date(event.occurred_at))}
                        </time>
                      </td>
                      <td>
                        <strong>{eventKinds[event.kind]}</strong>
                      </td>
                      <td>{event.product_display_name ?? '—'}</td>
                      <td>
                        {event.summary}
                        <details className={timeline.historyDetails}>
                          <summary>Подробнее</summary>
                          <span className={card.cellSecondary}>
                            Событие {formatFeedTime(event.occurred_at)} МСК
                          </span>
                          <span className={card.cellSecondary}>
                            Записано {formatFeedTime(event.recorded_at)} МСК
                          </span>
                          <span className={card.cellSecondary}>
                            ID события <span>{event.id}</span>
                          </span>
                          <div className={styles.actions}>
                            {eventLinks(event, grants, search).map((link) => (
                              <ManagerLink
                                key={link.search}
                                search={link.search}
                                navigate={navigate}
                              >
                                {link.label}
                              </ManagerLink>
                            ))}
                          </div>
                        </details>
                      </td>
                      <td>{event.actor_display ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ol className={timeline.list}>
              {page.data.items.map((event) => (
                <FeedEvent
                  key={event.id}
                  event={event}
                  showClientLabels={grants.includes('clients.read')}
                  links={eventLinks(event, grants, search)}
                  navigate={navigate}
                />
              ))}
            </ol>
          )}
          {page.data.next_cursor ? (
            <div className={history ? card.pager : undefined}>
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
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
