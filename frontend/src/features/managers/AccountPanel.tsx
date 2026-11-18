import type { ReactNode } from 'react'
import { DataTable } from '../../components/DataTable'
import { CellValue } from './CellValue'
import type { Cell } from './fixtures'
import styles from './AccountPanels.module.css'

export function Panel({
  title,
  hint,
  action,
  children,
}: {
  title: string
  hint?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        <h2>{title}</h2>
        {hint ? <span>{hint}</span> : null}
        {action ? <div className={styles.action}>{action}</div> : null}
      </header>
      {children}
    </section>
  )
}

type TableRow = { id: string; cells: readonly Cell[] }

export function Table({
  columns,
  rows,
}: {
  columns: readonly string[]
  rows: readonly TableRow[]
}) {
  if (!rows.length) return <p className={styles.empty}>Нет записей.</p>
  return (
    <div className={styles.table}>
      <DataTable<TableRow>
        rows={[...rows]}
        rowKey={(row) => row.id}
        columns={columns.map((header, index) => ({
          id: header,
          header,
          cell: (row) => <CellValue value={row.cells[index]} />,
        }))}
      />
    </div>
  )
}

export function Filters({
  filters,
  active,
  change,
  children,
}: {
  filters: readonly { label: string; count?: number }[]
  active: string
  change: (label: string) => void
  children?: ReactNode
}) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.chips}>
        {filters.map(({ label, count }) => (
          <button
            key={label}
            type="button"
            aria-pressed={active === label}
            onClick={() => change(label)}
          >
            {label}
            {count === undefined ? '' : ` · ${count}`}
          </button>
        ))}
      </div>
      {children}
    </div>
  )
}
