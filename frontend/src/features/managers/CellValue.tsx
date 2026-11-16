import type { Cell } from './fixtures'
import styles from './ManagersPage.module.css'

export function CellValue({ value }: { value: Cell }) {
  if (typeof value === 'string') return value
  return (
    <>
      {value.line ? (
        <span className={styles.line} data-line={value.line}>
          {value.line}
        </span>
      ) : null}
      {value.detail ? (
        <details className={styles.dealDetails}>
          <summary>{value.text}</summary>
          <p>{value.detail}</p>
          <small>Локальный пример · CRM не открывается</small>
        </details>
      ) : (
        <span className={value.tone ? styles.pill : undefined} data-tone={value.tone}>
          {value.text}
        </span>
      )}
      {value.note ? <small className={styles.note}>{value.note}</small> : null}
      {value.tags?.length ? (
        <span className={styles.tags}>
          {value.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </span>
      ) : null}
    </>
  )
}
