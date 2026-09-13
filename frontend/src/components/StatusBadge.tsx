import { isKnownState, lookupState, type StateDomain } from '../states'
import styles from './StatusBadge.module.css'

type Props = {
  domain: StateDomain
  state: string | null | undefined
  raw?: string | null
  testId?: string
}

export function StatusBadge({ domain, state, raw, testId }: Props) {
  const entry = lookupState(domain, state)
  const showRaw = Boolean(raw) && (!state || !isKnownState(domain, state))
  return (
    <span
      className={`${styles.badge} ${styles[entry.tone]}`}
      data-testid={testId}
      title={raw ?? undefined}
    >
      {entry.label}
      {showRaw ? <span className={styles.raw}>{raw}</span> : null}
    </span>
  )
}
