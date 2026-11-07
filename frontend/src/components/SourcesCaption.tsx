import type { SourceStatus } from '../api/types'
import { formatTime } from '../lib/format'
import styles from './SourcesCaption.module.css'

type Props = {
  sources?: SourceStatus[] | null
}

/**
 * Shows the source line only when a source answered partially (ADR-0021).
 * Available sources are in the page refresh tooltip; unavailable ones are
 * reported by `SourcesBanner`.
 */
export function SourcesCaption({ sources }: Props) {
  const degraded = (sources ?? []).filter((item) => item.status === 'degraded')
  if (degraded.length === 0) {
    return null
  }
  return (
    <p className={styles.caption}>
      {degraded.map((source) => (
        <span key={source.backend}>
          Источник {source.backend} ответил частично · данные на{' '}
          <time dateTime={source.observed_at ?? undefined}>{formatTime(source.observed_at)}</time>
        </span>
      ))}
    </p>
  )
}
