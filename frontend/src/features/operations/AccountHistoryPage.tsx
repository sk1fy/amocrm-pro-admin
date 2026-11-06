import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { usePushSearch, useRouteParams, useRouteSearch } from '../../app/hooks'
import type { CursorSearch } from '../../app/search'
import { fetchAccount, fetchAccountHistory, keys } from '../../api/queries'
import type { HistoryItem } from '../../api/types'
import { DataTablePager } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { RefreshStatus } from '../../components/RefreshStatus'
import { SourcesBanner, allSourcesUnavailable } from '../../components/SourcesBanner'
import { SourcesCaption } from '../../components/SourcesCaption'
import { StatusBadge } from '../../components/StatusBadge'
import page from '../../components/page.module.css'
import { formatTime, formatTimeOnly } from '../../lib/format'
import { actorLabel, auditLabel, isFailedAudit } from '../../lib/labels'
import { accountWidgetNames } from './accountWidgets'
import { commandTitle } from './commands'
import styles from './AccountHistoryPage.module.css'

export function historyObjectHref(item: HistoryItem, accountId: string): string | null {
  if (item.connection_id && item.backend) {
    return `/accounts/${accountId}/widgets/${item.backend}/${item.connection_id}`
  }
  if (item.object_type === 'account' && item.object_id) {
    return `/accounts/${item.object_id}`
  }
  if (item.object_ref?.startsWith('account:')) {
    const id = item.object_ref.slice('account:'.length)
    return id ? `/accounts/${id}` : null
  }
  if (item.object_type === 'job' || item.object_ref?.includes('job:')) {
    return '/operations'
  }
  if (item.object_ref?.startsWith('/accounts/') || item.object_ref?.startsWith('/operations/')) {
    return item.object_ref
  }
  return null
}

/** Human name of an event; an action without a description keeps its code. */
export function historyTitle(action: string): string {
  const label = auditLabel(action)
  return label === auditLabel('') ? action : label
}

/**
 * Title of a history line. Operation events name the command that was run,
 * otherwise «Операция выполнена» repeats without saying what was done.
 */
export function historyItemTitle(item: HistoryItem): string {
  const title = historyTitle(item.action)
  const command = operationCommand(item)
  if (!command || !item.action.startsWith('operation.')) {
    return title
  }
  return `${title}: «${commandTitle(item.object_type ?? '', command)}»`
}

function operationCommand(item: HistoryItem): string | null {
  const metadata = item.metadata
  if (!metadata || typeof metadata !== 'object') {
    return null
  }
  const command = (metadata as Record<string, unknown>).command
  return typeof command === 'string' && command !== '' ? command : null
}

/**
 * Words for the object link instead of a UUID (ADR-0021): the widget of a
 * connection when the account card knows it, otherwise the kind of object.
 */
export function historyObjectLabel(
  item: HistoryItem,
  widgetNames: ReadonlyMap<string, string>,
): string {
  if (item.connection_id) {
    return widgetNames.get(item.connection_id) ?? 'Подключение'
  }
  if (item.object_type === 'account' || item.object_ref?.startsWith('account:')) {
    return 'Аккаунт'
  }
  if (item.object_type === 'job' || item.object_ref?.includes('job:')) {
    return 'Задачи'
  }
  if (item.object_ref?.startsWith('/operations/')) {
    return 'Операция'
  }
  return 'Открыть'
}

/**
 * Outcome worth a mark: a failure or denial, or an outcome we do not know.
 * Success is the norm and stays unmarked (ADR-0021).
 */
export function historyOutcome(item: HistoryItem): string | null {
  if (isFailedAudit(item.action, item.outcome)) {
    return item.outcome === 'denied' ? 'denied' : 'failed'
  }
  return item.outcome && item.outcome !== 'ok' ? item.outcome : null
}

function historyActor(item: HistoryItem): string {
  return item.actor_email || actorLabel(item.actor_type)
}

function objectKey(item: HistoryItem): string {
  return item.connection_id ?? item.object_ref ?? item.object_id ?? ''
}

function sameEvent(left: HistoryItem, right: HistoryItem): boolean {
  return (
    left.action === right.action &&
    operationCommand(left) === operationCommand(right) &&
    left.source === right.source &&
    objectKey(left) === objectKey(right) &&
    (left.outcome ?? '') === (right.outcome ?? '') &&
    historyActor(left) === historyActor(right)
  )
}

export type HistoryEntry = {
  item: HistoryItem
  /** Identical consecutive events folded into this line. */
  count: number
  /** occurred_at of the oldest folded event. */
  earliest: string
}

export type HistoryDay = {
  key: string
  label: string
  entries: HistoryEntry[]
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function historyDayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return 'Дата неизвестна'
  }
  const sameYear = date.getFullYear() === now.getFullYear()
  const label = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (localDayKey(date) === localDayKey(now)) {
    return `Сегодня, ${label}`
  }
  if (localDayKey(date) === localDayKey(yesterday)) {
    return `Вчера, ${label}`
  }
  return label
}

/**
 * Splits the feed (newest first) into local days and folds consecutive
 * identical events — same action, object, outcome and actor — into one line.
 */
export function groupHistory(items: HistoryItem[], now: Date = new Date()): HistoryDay[] {
  const days: HistoryDay[] = []
  for (const item of items) {
    const date = new Date(item.occurred_at)
    const key = Number.isNaN(date.getTime()) ? 'unknown' : localDayKey(date)
    let day = days.at(-1)
    if (!day || day.key !== key) {
      day = { key, label: historyDayLabel(item.occurred_at, now), entries: [] }
      days.push(day)
    }
    const last = day.entries.at(-1)
    if (last && sameEvent(last.item, item)) {
      last.count += 1
      last.earliest = item.occurred_at
    } else {
      day.entries.push({ item, count: 1, earliest: item.occurred_at })
    }
  }
  return days
}

function entryTooltip(entry: HistoryEntry): string {
  const { item } = entry
  const lines = [`${historyItemTitle(item)} · ${item.action}`, `Источник: ${item.source}`]
  if (entry.count > 1) {
    lines.push(
      `Одинаковых событий подряд: ${entry.count}, ${formatTime(entry.earliest)} — ${formatTime(item.occurred_at)}`,
    )
  }
  const object = item.object_ref ?? item.object_id
  if (object) {
    lines.push(`Объект: ${object}`)
  }
  return lines.join('\n')
}

function HistoryObject({
  item,
  accountId,
  widgetNames,
}: {
  item: HistoryItem
  accountId: string
  widgetNames: ReadonlyMap<string, string>
}) {
  if (item.connection_id && item.backend) {
    return (
      <Link
        to="/accounts/$accountId/widgets/$backend/$connectionId"
        params={{ accountId, backend: item.backend, connectionId: item.connection_id }}
      >
        {historyObjectLabel(item, widgetNames)}
      </Link>
    )
  }
  const href = historyObjectHref(item, accountId)
  // The account itself is the page we are on: no link to it.
  if (!href || href === `/accounts/${accountId}`) {
    return null
  }
  return <a href={href}>{historyObjectLabel(item, widgetNames)}</a>
}

export function AccountHistoryPage() {
  const { accountId } = useRouteParams<{ accountId: string }>()
  const search = useRouteSearch<CursorSearch>()
  const pushSearch = usePushSearch()
  const path = `/accounts/${accountId}/history`
  const limit = search.limit ?? 25
  const params = { cursor: search.cursor, limit }
  const history = useQuery({
    queryKey: keys.accountHistory(accountId, params),
    queryFn: () => fetchAccountHistory(accountId, params),
  })
  const account = useQuery({
    queryKey: keys.account(accountId),
    queryFn: () => fetchAccount(accountId),
  })
  const widgetNames = accountWidgetNames(account.data)

  if (history.isPending) {
    return <div className={page.skeleton} />
  }
  if (history.error && !history.data) {
    return <ErrorState error={history.error} onRetry={() => void history.refetch()} />
  }
  const items = history.data?.items ?? []
  const sources = history.data?.sources
  const days = groupHistory(items)
  return (
    <div className={page.page}>
      <div className={styles.toolbar}>
        <RefreshStatus
          updatedAt={history.dataUpdatedAt}
          fetching={history.isFetching}
          failed={Boolean(history.error)}
          onRefresh={() => void history.refetch({ cancelRefetch: false })}
          sources={sources}
        />
      </div>
      <SourcesBanner sources={sources} />
      {items.length === 0 ? (
        allSourcesUnavailable(sources) ? (
          <EmptyState
            title="Источник недоступен"
            description="Историю нельзя показать, пока бекенд не ответит. Это не пустая история."
          />
        ) : (
          <EmptyState
            title="История пуста"
            description="Источник ответил, событий по аккаунту нет."
          />
        )
      ) : null}
      {items.length > 0 ? (
        <>
          <SourcesCaption sources={sources} />
          <div className={styles.feed}>
            {days.map((day) => (
              <section key={day.key} className={styles.day}>
                <h2 className={styles.dayTitle}>{day.label}</h2>
                <ol className={styles.timeline}>
                  {day.entries.map((entry, index) => {
                    const { item } = entry
                    const outcome = historyOutcome(item)
                    return (
                      <li
                        key={`${index}:${item.source}:${item.occurred_at}:${item.action}`}
                        className={
                          outcome === 'failed' || outcome === 'denied' ? styles.failed : undefined
                        }
                        title={entryTooltip(entry)}
                      >
                        <time dateTime={item.occurred_at} className={styles.time}>
                          {formatTimeOnly(item.occurred_at)}
                        </time>
                        <div className={styles.body}>
                          <p className={styles.action}>
                            <span>{historyItemTitle(item)}</span>
                            {entry.count > 1 ? (
                              <span
                                className={styles.count}
                                title={`Одинаковых событий подряд: ${entry.count}`}
                              >
                                ×{entry.count}
                              </span>
                            ) : null}
                            {outcome ? (
                              <StatusBadge domain="audit_outcome" state={outcome} raw={outcome} />
                            ) : null}
                          </p>
                          <p className={styles.meta}>
                            <span>{historyActor(item)}</span>
                            <HistoryObject
                              item={item}
                              accountId={accountId}
                              widgetNames={widgetNames}
                            />
                          </p>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </section>
            ))}
          </div>
          <DataTablePager
            rowCount={items.length}
            total={history.data?.total}
            nextCursor={history.data?.next_cursor}
            resetDisabled={!search.cursor}
            limit={limit}
            onLimitChange={(next) =>
              pushSearch(path, { ...search, limit: next, cursor: undefined })
            }
            onReset={() => pushSearch(path, { ...search, cursor: undefined })}
            onNext={() =>
              pushSearch(path, {
                ...search,
                cursor: history.data?.next_cursor ?? undefined,
              })
            }
          />
        </>
      ) : null}
    </div>
  )
}
