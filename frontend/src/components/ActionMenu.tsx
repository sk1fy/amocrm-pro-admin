import type { ReactNode } from 'react'
import styles from './ActionMenu.module.css'

type Props = {
  label?: string
  children: ReactNode
}

export function ActionMenu({ label = 'Ещё', children }: Props) {
  return (
    <details className={styles.menu}>
      <summary>{label}</summary>
      <div className={styles.panel}>{children}</div>
    </details>
  )
}
