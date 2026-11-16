import { Link } from '@tanstack/react-router'
import { findDemoClient } from './clientDirectory'
import { useDemo, type SessionEvent } from './DemoSession'
import { feedSnapshot, type FeedEvent, type FeedKind } from './feedFixtures'
import styles from './FeedBoard.module.css'

const icons: Record<FeedKind, string> = {
  install: 'M8 3v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10',
  activate: 'M8 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5M3 13.5c.8-2.4 2.7-3.5 5-3.5s4.2 1.1 5 3.5',
  renew: 'M13 8a5 5 0 1 1-1.5-3.6M13 3v2.5h-2.5M8 5.5V8l1.8 1.2',
  remove: 'M4 4l8 8M12 4l-8 8',
  end: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 1 0 0-11M8 5v3.2l2 1.3',
  sub: 'M4 3h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM2 6.5h12',
  edit: 'M10.5 2.5l3 3L6 13H3v-3z',
}
const shortDate = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

function fromSessionEvent(event: SessionEvent): FeedEvent {
  const kind = event.kind === 'payment' ? 'sub' : event.kind
  const actor = event.actor && !event.details.includes(event.actor) ? event.actor : ''
  return { ...event, kind, details: [event.details, actor].filter(Boolean).join(' · ') }
}

export function FeedBoard() {
  const { state } = useDemo()
  const events = [...state.events.map(fromSessionEvent), ...feedSnapshot]
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 80)

  return (
    <section className={styles.board} aria-labelledby="manager-feed-title">
      <header>
        <h1 id="manager-feed-title">Лента событий</h1>
        <p className={styles.description}>
          Установки, активации, продления, подписка, окончания теста и удаления по всем аккаунтам
        </p>
      </header>
      <ol className={styles.list} aria-label="События">
        {events.map((event) => {
          const client = findDemoClient(event.client)
          const details = [event.title, event.widget === '—' ? '' : event.widget, event.details]
            .filter(Boolean)
            .join(' · ')
          return (
            <li className={styles.row} key={event.id}>
              <span className={styles.icon} data-kind={event.kind} aria-hidden="true">
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={icons[event.kind]} />
                </svg>
              </span>
              {client ? (
                <Link
                  className={styles.account}
                  to="/managers"
                  search={{ section: 'feed', client: client.id }}
                >
                  <span className={styles.domain}>{client.domain}</span>
                  <small>{details}</small>
                </Link>
              ) : (
                <div className={styles.account}>
                  <span className={styles.domain}>{event.client}</span>
                  <small>{details}</small>
                </div>
              )}
              <time className={styles.date} dateTime={event.date}>
                {shortDate.format(new Date(event.date)).replace('.', '')}
              </time>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
