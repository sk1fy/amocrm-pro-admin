import { StatusBadge } from '../../components/StatusBadge'
import { lookupState } from '../../states'
import styles from './WidgetsPage.module.css'

export type ConnectionCountsSummary = {
  total: number
  deviations: Array<{ state: string; count: number }>
}

/**
 * Total connections and only the states that need attention (ADR-0021):
 * active connections are the norm and are counted, not badged.
 */
export function summarizeConnections(counts: Record<string, number>): ConnectionCountsSummary {
  let total = 0
  const deviations: ConnectionCountsSummary['deviations'] = []
  for (const [state, count] of Object.entries(counts)) {
    total += count
    if (count > 0 && lookupState('connection', state).tone !== 'ok') {
      deviations.push({ state, count })
    }
  }
  return { total, deviations }
}

export function connectionsLabel(count: number): string {
  if (count === 0) {
    return 'Нет подключений'
  }
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} подключение`
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} подключения`
  }
  return `${count} подключений`
}

export function ConnectionCounts({
  counts,
  wordy = false,
}: {
  counts: Record<string, number>
  /** «3 подключения» instead of a bare number (page header facts). */
  wordy?: boolean
}) {
  const { total, deviations } = summarizeConnections(counts)
  return (
    <span className={styles.counts}>
      <span className={wordy ? undefined : styles.total}>
        {wordy ? connectionsLabel(total) : total}
      </span>
      {deviations.map(({ state, count }) => (
        <span key={state} className={styles.deviation}>
          <span className={styles.deviationCount}>{count}</span>
          <StatusBadge domain="connection" state={state} raw={state} />
        </span>
      ))}
    </span>
  )
}
