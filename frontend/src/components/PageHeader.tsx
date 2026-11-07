import type { ReactNode } from 'react'
import styles from './PageHeader.module.css'

type Props = {
  title: ReactNode
  description?: ReactNode
  /** Short facts under the title: ID, counts, deviation badges. */
  meta?: ReactNode
  /** Page commands, rendered before the refresh control. */
  actions?: ReactNode
  /** Usually `<RefreshStatus />`. */
  refresh?: ReactNode
  /** Heading level; nested pages (account tabs) use `h2` content below. */
  as?: 'h1' | 'h2'
}

/** One header per page (ADR-0021): title, facts and actions on one line. */
export function PageHeader({ title, description, meta, actions, refresh, as = 'h1' }: Props) {
  const Heading = as
  return (
    <header className={styles.header}>
      <div className={styles.heading}>
        <Heading className={styles.title}>{title}</Heading>
        {meta ? <div className={styles.meta}>{meta}</div> : null}
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions || refresh ? (
        <div className={styles.side}>
          {refresh}
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </div>
      ) : null}
    </header>
  )
}
