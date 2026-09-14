import type { ReactNode } from 'react'
import type { Observation as ObservationType } from '../api/types'
import { formatRelativeTime, formatTime } from '../lib/format'
import { StatusBadge } from './StatusBadge'
import styles from './Observation.module.css'

type Props<T> = {
  title?: string
  observation: ObservationType<T>
  onRetry?: () => void
  hideSource?: boolean
  status?: ReactNode
  dependentHint?: ReactNode
  children?: (data: T) => ReactNode
}

export function Observation<T>({
  title,
  observation,
  onRetry,
  hideSource = false,
  status,
  dependentHint,
  children,
}: Props<T>) {
  const caption = (
    <div className={styles.caption}>
      <div className={styles.head}>
        {title ? <strong>{title}</strong> : <span />}
        <div className={styles.status}>
          {status}
          <StatusBadge domain="freshness" state={observation.freshness} />
        </div>
      </div>
      <p className={styles.meta}>
        <time dateTime={observation.observed_at} title={observation.observed_at}>
          {observation.freshness === 'stale'
            ? `данные от ${formatTime(observation.observed_at)}`
            : `Обновлено ${formatRelativeTime(observation.observed_at)}`}
        </time>
        {hideSource ? null : <span>источник: {observation.source}</span>}
      </p>
    </div>
  )

  if (observation.freshness === 'unavailable') {
    return (
      <section className={`${styles.block} ${styles.card} ${styles.unavailable}`}>
        {caption}
        {dependentHint ?? (observation.error?.message ? <p>{observation.error.message}</p> : null)}
        {onRetry ? (
          <div className={styles.actions}>
            <button type="button" onClick={onRetry}>
              Повторить
            </button>
          </div>
        ) : null}
      </section>
    )
  }

  if (observation.freshness === 'unknown') {
    return (
      <section className={`${styles.block} ${styles.card} ${styles.unknown}`}>
        {caption}
        {dependentHint ?? (observation.error?.message ? <p>{observation.error.message}</p> : null)}
        {onRetry ? (
          <div className={styles.actions}>
            <button type="button" onClick={onRetry}>
              Повторить
            </button>
          </div>
        ) : null}
      </section>
    )
  }

  const data = observation.data
  return (
    <section className={`${styles.block} ${styles.card}`}>
      {caption}
      {data === null || data === undefined ? null : children ? children(data) : null}
    </section>
  )
}
