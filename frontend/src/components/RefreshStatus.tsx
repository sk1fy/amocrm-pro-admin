import type { SourceStatus } from '../api/types'
import { formatTime, formatTimeOnly } from '../lib/format'
import styles from './RefreshStatus.module.css'

export function sourcesTooltip(sources?: SourceStatus[] | null): string | null {
  const list = (sources ?? []).filter((source) => source.status !== 'unavailable')
  if (list.length === 0) {
    return null
  }
  return list
    .map((source) => `Источник ${source.backend}: данные на ${formatTime(source.observed_at)}`)
    .join('\n')
}

/**
 * Compact refresh control for the page header (ADR-0021): an icon button
 * and the time of the last successful load. Sources and their observed_at
 * are in the tooltip.
 */
export function RefreshStatus({
  updatedAt,
  fetching,
  failed,
  onRefresh,
  sources,
}: {
  updatedAt: number
  fetching: boolean
  failed?: boolean
  onRefresh: () => void
  sources?: SourceStatus[] | null
}) {
  const iso = updatedAt ? new Date(updatedAt).toISOString() : null
  const origin = sourcesTooltip(sources)
  const tooltip = [`Обновлено ${formatTime(iso)}`, origin].filter(Boolean).join('\n')
  return (
    <div className={styles.refresh} title={tooltip}>
      {failed ? (
        <span className={styles.failed} role="alert">
          Не удалось обновить — показаны прежние данные
        </span>
      ) : null}
      <span role="status" className={styles.time}>
        {fetching ? 'Обновляется…' : iso ? `Обновлено в ${formatTimeOnly(iso)}` : ''}
      </span>
      <button
        type="button"
        className={styles.button}
        data-variant="ghost"
        disabled={fetching}
        onClick={onRefresh}
        aria-label="Обновить"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          width="14"
          height="14"
          className={fetching ? styles.spin : undefined}
        >
          <path
            d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89M13.5 2.5v3h-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}
