import { Fragment, useState, type ReactNode } from 'react'
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
  renderDetail?: (row: T) => ReactNode
  detailLabel?: string
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  nextCursor,
  onNext,
  onReset,
  renderDetail,
  detailLabel = 'Подробнее',
}: Props<T>) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggle(key: string) {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

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
            {renderDetail ? <th scope="col" className={styles.expandHead} /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row)
            const isExpanded = expanded.has(key)
            return (
              <Fragment key={key}>
                <tr>
                  {columns.map((column) => (
                    <td key={column.id}>{column.cell(row)}</td>
                  ))}
                  {renderDetail ? (
                    <td className={styles.expandCell}>
                      <button
                        type="button"
                        className={styles.expandButton}
                        aria-expanded={isExpanded}
                        aria-label={detailLabel}
                        title={detailLabel}
                        onClick={() => toggle(key)}
                      >
                        {isExpanded ? '▾' : '▸'}
                      </button>
                    </td>
                  ) : null}
                </tr>
                {renderDetail && isExpanded ? (
                  <tr className={styles.detailRow}>
                    <td className={styles.detailCell} colSpan={columns.length}>
                      {renderDetail(row)}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
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
