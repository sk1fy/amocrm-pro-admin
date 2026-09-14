import type { ReactNode } from 'react'
import type { CoreAuthIncident } from '../lib/incidents'
import { formatRelativeTime, formatTime } from '../lib/format'
import { TechnicalDetails } from './TechnicalDetails'
import page from './page.module.css'
import styles from './IncidentBanner.module.css'

type Props = {
  incident: CoreAuthIncident
  onRetry?: () => void
  extra?: ReactNode
}

export function IncidentBanner({ incident, onRetry, extra }: Props) {
  return (
    <section className={styles.banner} aria-labelledby="core-incident-title">
      <h3 id="core-incident-title">{incident.title}</h3>
      <p>{incident.affects}</p>
      <p>
        <strong>Что сделать:</strong> {incident.action}
      </p>
      {incident.firstAt || incident.lastAt ? (
        <p className={page.muted}>
          {incident.firstAt ? (
            <>
              Первая ошибка{' '}
              <time dateTime={incident.firstAt} title={formatTime(incident.firstAt)}>
                {formatRelativeTime(incident.firstAt)}
              </time>
            </>
          ) : null}
          {incident.firstAt && incident.lastAt ? ' · ' : null}
          {incident.lastAt ? (
            <>
              последняя{' '}
              <time dateTime={incident.lastAt} title={formatTime(incident.lastAt)}>
                {formatRelativeTime(incident.lastAt)}
              </time>
            </>
          ) : null}
        </p>
      ) : null}
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          Повторить запрос
        </button>
      ) : null}
      {extra}
      <TechnicalDetails>
        <p className={styles.technical}>{incident.technical}</p>
      </TechnicalDetails>
    </section>
  )
}
