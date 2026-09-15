import type { ReactNode } from 'react'
import styles from './TechnicalDetails.module.css'

type Props = {
  children: ReactNode
  defaultOpen?: boolean
  summary?: string
}

export function TechnicalDetails({
  children,
  defaultOpen = false,
  summary = 'Техническая информация',
}: Props) {
  return (
    <details className={styles.details} open={defaultOpen || undefined}>
      <summary>{summary}</summary>
      <div className={styles.body}>{children}</div>
    </details>
  )
}
