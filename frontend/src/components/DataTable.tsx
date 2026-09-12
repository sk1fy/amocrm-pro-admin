import type { ReactNode } from 'react'
import styles from './DataTable.module.css'

type Column<T> = {
  id: string
  header: string
  cell: (row: T) => ReactNode
}

type Props<T> = {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  nextCursor?: string | null
  onNext?: () => void
  onReset?: () => void
}

export function DataTable<T>({ columns, rows, rowKey, nextCursor, onNext, onReset }: Props<T>) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.id}>{column.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {onNext || onReset ? (
        <div className={styles.pager}>
          {onReset ? (
            <button type="button" onClick={onReset}>
              В начало
            </button>
          ) : null}
          {onNext ? (
            <button type="button" onClick={onNext} disabled={!nextCursor}>
              Дальше
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
