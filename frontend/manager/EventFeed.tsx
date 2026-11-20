import { useState, type FormEvent } from 'react'
import { FilterBar, FilterField } from '../src/components/FilterBar'
import { ManagerLink } from './accountsLocation'
import { eventKinds, type ManagerEvent } from './eventsApi'
import styles from './Timeline.module.css'

const eventDay = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Moscow',
})

const eventTime = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: 'Europe/Moscow',
})

export function formatFeedTime(value: string) {
  return eventTime.format(Date.parse(value))
}

const installation = 'M12 3v12m-4-4 4 4 4-4M5 19h14'
const person = 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2'
const eventIcons = {
  installed: { path: installation, tone: 'accent' },
  reinstalled: { path: installation, tone: 'accent' },
  reauthorized: { path: 'M5 12l4 4L19 6', tone: 'ok' },
  uninstalled: { path: 'M6 6l12 12M18 6L6 18', tone: 'error' },
  activated: { path: person, tone: 'accent' },
  installation_reviewed: { path: 'M5 12l4 4L19 6', tone: 'ok' },
  installation_unreviewed: { path: 'M6 10h11a4 4 0 0 1 0 8h-4M9 6l-4 4 4 4', tone: 'attention' },
  account_profile_updated: { path: person, tone: 'accent' },
  portrait_updated: { path: person, tone: 'accent' },
  access_renewed: { path: 'M12 8v4l2 2m7-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', tone: 'ok' },
}

export function FeedFilters({
  query,
  apply,
  reset,
}: {
  query: URLSearchParams
  apply: (event: FormEvent<HTMLFormElement>) => void
  reset: () => void
}) {
  const [kinds, setKinds] = useState(() => query.getAll('kind'))
  const applied = query.getAll('kind')
  const linkedFilters = [
    { id: 'account_id', label: 'ID аккаунта', value: query.get('account_id') },
    { id: 'product_id', label: 'ID продукта', value: query.get('product_id') },
  ]
  return (
    <FilterBar
      onSubmit={apply}
      chips={[
        ...Object.entries(eventKinds)
          .filter(([kind]) => applied.includes(kind))
          .map(([id, value]) => ({ id, label: 'Тип события', value })),
        ...linkedFilters.flatMap(({ id, label, value }) => (value ? [{ id, label, value }] : [])),
      ]}
    >
      {linkedFilters.map(({ id, value }) =>
        value ? <input key={id} type="hidden" name={id} value={value} /> : null,
      )}
      <details className={styles.kindFilter}>
        <summary>
          {kinds.length === 0 ? 'Все виды событий' : 'Виды событий'}
          {kinds.length > 0 && <span className={styles.kindCount}>{kinds.length}</span>}
        </summary>
        <fieldset className={styles.kindOptions}>
          <legend>Виды событий</legend>
          {Object.entries(eventKinds).map(([kind, label]) => (
            <label key={kind}>
              <input
                type="checkbox"
                name="kind"
                value={kind}
                checked={kinds.includes(kind)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked
                  setKinds((selected) =>
                    checked ? [...selected, kind] : selected.filter((value) => value !== kind),
                  )
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
      </details>
      <div className={styles.period}>
        <FilterField label="С (Москва)">
          <input type="date" name="from" defaultValue={query.get('from') ?? ''} />
        </FilterField>
        <FilterField label="По (Москва)">
          <input type="date" name="to" defaultValue={query.get('to') ?? ''} />
        </FilterField>
      </div>
      {query.has('limit') && <input type="hidden" name="limit" value={query.get('limit') ?? ''} />}
      <button type="submit">Применить</button>
      <button
        type="button"
        onClick={(event) => {
          event.currentTarget.form?.reset()
          setKinds([])
          reset()
        }}
      >
        Сбросить
      </button>
    </FilterBar>
  )
}

export function FeedEvent({
  event,
  showClientLabels,
  links,
  navigate,
}: {
  event: ManagerEvent
  showClientLabels: boolean
  links: { label: string; search: string }[]
  navigate: (search: string) => void
}) {
  const kind = eventKinds[event.kind]
  const icon = eventIcons[event.kind]
  const account = showClientLabels ? event.account_subdomain : undefined
  const product = showClientLabels ? event.product_display_name : undefined
  const occurred = Date.parse(event.occurred_at)
  return (
    <li className={styles.row}>
      <details>
        <summary className={styles.eventSummary}>
          <span className={styles.eventIcon} data-tone={icon.tone} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d={icon.path} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className={styles.eventText}>
            <span className={styles.eventTitle}>{account ?? kind}</span>
            <span className={styles.eventDescription}>
              {event.summary}
              {product && ` · ${product}`}
            </span>
          </span>
          <span className={styles.when}>
            <time dateTime={event.occurred_at}>{eventDay.format(occurred)}</time>
            <span className={styles.detailLabel}>Подробнее</span>
          </span>
        </summary>
        <div className={styles.eventDetails}>
          <dl>
            <dt>Событие (Москва)</dt>
            <dd>
              <time dateTime={event.occurred_at}>{formatFeedTime(event.occurred_at)}</time>
            </dd>
            <dt>Записано (Москва)</dt>
            <dd>
              <time dateTime={event.recorded_at}>{formatFeedTime(event.recorded_at)}</time>
            </dd>
            {event.actor_display && (
              <>
                <dt>Исполнитель</dt>
                <dd>{event.actor_display}</dd>
              </>
            )}
            <dt>ID события</dt>
            <dd>{event.id}</dd>
          </dl>
          {links.length > 0 && (
            <div className={styles.eventLinks}>
              {links.map((link) => (
                <ManagerLink key={link.search} search={link.search} navigate={navigate}>
                  {link.label}
                </ManagerLink>
              ))}
            </div>
          )}
        </div>
      </details>
    </li>
  )
}
