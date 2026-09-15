import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

type Props = {
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: Props) {
  return (
    <div className={styles.box} role="status">
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}
