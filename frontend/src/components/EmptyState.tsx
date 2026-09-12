import styles from './EmptyState.module.css'

type Props = {
  title: string
  description?: string
}

export function EmptyState({ title, description }: Props) {
  return (
    <div className={styles.box} role="status">
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
    </div>
  )
}
