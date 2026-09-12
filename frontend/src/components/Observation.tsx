import type { ReactNode } from 'react'
import type { Observation as ObservationType } from '../api/types'
import { formatTime } from '../lib/format'
import { lookupState } from '../states'
import { StatusBadge } from './StatusBadge'
import styles from './Observation.module.css'

type Props<T> = {
  title?: string
  observation: ObservationType<T>
  onRetry?: () => void
  children?: (data: T) => ReactNode
}

export function Observation<T>({ title, observation, onRetry, children }: Props<T>) {
  const freshness = lookupState('freshness', observation.freshness)
  const caption = (
    <div className={styles.head}>
      {title ? <strong>{title}</strong> : null}
      <span>источник: {observation.source}</span>
      <time
        className={styles.time}
        dateTime={observation.observed_at}
        title={observation.observed_at}
      >
        {observation.freshness === 'stale'
          ? `данные от ${formatTime(observation.observed_at)}`
          : formatTime(observation.observed_at)}
      </time>
      <StatusBadge domain="freshness" state={observation.freshness} />
    </div>
  )

  if (observation.freshness === 'unavailable') {
    return (
      <section className={`${styles.block} ${styles.unavailable}`}>
        {caption}
        <p>{observation.error?.message ?? freshness.label}</p>
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
      <section className={`${styles.block} ${styles.unknown}`}>
        {caption}
        <p>{observation.error?.message ?? freshness.label}</p>
      </section>
    )
  }

  const data = observation.data
  return (
    <section className={`${styles.block} ${observation.freshness === 'stale' ? styles.stale : ''}`}>
      {caption}
      {data === null || data === undefined ? null : children ? children(data) : null}
    </section>
  )
}
