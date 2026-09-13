import type { SourceStatus } from '../api/types'
import { formatTime } from '../lib/format'
import { lookupState } from '../states'
import styles from './SourcesBanner.module.css'

type Props = {
  sources?: SourceStatus[] | null
}

export function sourcesUnavailable(sources?: SourceStatus[] | null): boolean {
  return Boolean(sources?.some((source) => source.status === 'unavailable'))
}

export function allSourcesUnavailable(sources?: SourceStatus[] | null): boolean {
  return Boolean(
    sources && sources.length > 0 && sources.every((source) => source.status === 'unavailable'),
  )
}

export function SourcesBanner({ sources }: Props) {
  const bad = (sources ?? []).filter((source) => source.status === 'unavailable')
  if (bad.length === 0) {
    return null
  }
  return (
    <div className={styles.banner} role="status">
      Часть источников недоступна
      <ul className={styles.list}>
        {bad.map((source) => (
          <li key={source.backend}>
            {source.backend}: {lookupState('source', source.status).label}
            {source.error?.message ? ` — ${source.error.message}` : ''}
            {source.observed_at ? ` (${formatTime(source.observed_at)})` : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}
