import type { SourceStatus } from '../api/types'
import { formatTime } from '../lib/format'
import { allSourcesUnavailable } from './SourcesBanner'
import styles from './SourcesCaption.module.css'

type Props = {
  sources?: SourceStatus[] | null
}

export function SourcesCaption({ sources }: Props) {
  const list = sources ?? []
  if (list.length === 0 || allSourcesUnavailable(list)) {
    return null
  }
  const source = list.find((item) => item.status !== 'unavailable')
  if (!source) {
    return null
  }
  return (
    <p className={styles.caption}>
      источник: {source.backend} ·{' '}
      <time dateTime={source.observed_at ?? undefined}>{formatTime(source.observed_at)}</time>
      {source.status === 'degraded' ? ' · частично доступен' : ''}
    </p>
  )
}
