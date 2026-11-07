import { isKnownState, lookupState, type StateDomain } from '../states'
import styles from './StatusBadge.module.css'

type Props = {
  domain: StateDomain
  state: string | null | undefined
  raw?: string | null
  testId?: string
  /**
   * `badge` — filled pill, for deviations. `text` — dot and label without a
   * fill, for normal states in calm lists (ADR-0021). `dot` — dot only, the
   * label stays available to assistive tech and as a tooltip.
   */
  variant?: 'badge' | 'text' | 'dot'
  /** Renders `badge` for deviations and `text` for the `ok` tone. */
  calm?: boolean
  title?: string
}

export function StatusBadge({ domain, state, raw, testId, variant, calm, title }: Props) {
  const entry = lookupState(domain, state)
  const showRaw = Boolean(raw) && (!state || !isKnownState(domain, state))
  const resolved = variant ?? (calm && entry.tone === 'ok' ? 'text' : 'badge')
  const tooltip = title ?? raw ?? (resolved === 'dot' ? entry.label : undefined)
  if (resolved === 'dot') {
    return (
      <span
        className={`${styles.dot} ${styles[entry.tone]}`}
        data-testid={testId}
        title={tooltip}
        role="img"
        aria-label={entry.label}
      />
    )
  }
  return (
    <span
      className={`${resolved === 'text' ? styles.text : styles.badge} ${styles[entry.tone]}`}
      data-testid={testId}
      title={tooltip}
    >
      {entry.label}
      {showRaw ? <span className={styles.raw}>{raw}</span> : null}
    </span>
  )
}
