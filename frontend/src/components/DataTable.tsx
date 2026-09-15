import { Fragment, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { formatNull } from '../lib/format'
import styles from './DataTable.module.css'

export type DataTableColumn<T> = {
  id: string
  header: string
  cell: (row: T) => ReactNode
  width?: string
  ellipsis?: boolean
  mono?: boolean
  nowrap?: boolean
  title?: (row: T) => string
  sortValue?: (row: T) => string | number | null | undefined
}

type SortState = {
  id: string
  direction: 'asc' | 'desc'
}

export type DataTablePagerProps = {
  rowCount: number
  total?: number | null
  nextCursor?: string | null
  onNext?: () => void
  onReset?: () => void
  onPrev?: () => void
  resetDisabled?: boolean
}

type Props<T> = {
  columns: DataTableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  nextCursor?: string | null
  onNext?: () => void
  onReset?: () => void
  onPrev?: () => void
  resetDisabled?: boolean
  total?: number | null
  renderDetail?: (row: T) => ReactNode
  detailLabel?: string
  onRowClick?: (row: T) => void
}

function compareSortValues(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
): number {
  if (left == null && right == null) {
    return 0
  }
  if (left == null) {
    return 1
  }
  if (right == null) {
    return -1
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right
  }
  return String(left).localeCompare(String(right), 'ru')
}

export function pagerRangeLabel(rowCount: number, total?: number | null): string {
  const range = `1–${rowCount}`
  if (total === undefined) {
    return range
  }
  return `${range} из ${formatNull(total)}`
}

export function DataTablePager({
  rowCount,
  total,
  nextCursor,
  onNext,
  onReset,
  onPrev,
  resetDisabled,
}: DataTablePagerProps) {
  if (!onNext && !onReset && !onPrev) {
    return null
  }
  return (
    <div className={styles.pager}>
      <span className={styles.range}>{pagerRangeLabel(rowCount, total)}</span>
      {onReset ? (
        <button type="button" onClick={onReset} disabled={resetDisabled}>
          В начало
        </button>
      ) : null}
      {onPrev ? (
        <button type="button" onClick={onPrev}>
          Назад
        </button>
      ) : null}
      {onNext ? (
        <button type="button" onClick={onNext} disabled={!nextCursor}>
          Дальше
        </button>
      ) : null}
    </div>
  )
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  nextCursor,
  onNext,
  onReset,
  onPrev,
  resetDisabled,
  total,
  renderDetail,
  detailLabel = 'Подробнее',
  onRowClick,
}: Props<T>) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<SortState | null>(null)

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

  function toggleSort(column: DataTableColumn<T>) {
    if (!column.sortValue) {
      return
    }
    setSort((previous) => {
      if (previous?.id === column.id) {
        return { id: column.id, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
      }
      return { id: column.id, direction: 'asc' }
    })
  }

  const visibleRows = useMemo(() => {
    if (!sort) {
      return rows
    }
    const column = columns.find((item) => item.id === sort.id)
    if (!column?.sortValue) {
      return rows
    }
    const direction = sort.direction === 'asc' ? 1 : -1
    return [...rows].sort(
      (left, right) =>
        compareSortValues(column.sortValue?.(left), column.sortValue?.(right)) * direction,
    )
  }, [columns, rows, sort])

  function handleRowKey(event: KeyboardEvent<HTMLTableRowElement>, row: T) {
    if (!onRowClick) {
      return
    }
    if (event.target !== event.currentTarget) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onRowClick(row)
    }
  }

  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((column) => {
              const sortable = Boolean(column.sortValue)
              const ariaSort =
                sort?.id === column.id
                  ? sort.direction === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : undefined
              return (
                <th
                  key={column.id}
                  scope="col"
                  style={column.width ? { width: column.width, maxWidth: column.width } : undefined}
                  aria-sort={sortable ? (ariaSort ?? 'none') : undefined}
                >
                  {sortable ? (
                    <button
                      type="button"
                      className={styles.sortButton}
                      aria-label={`Сортировать: ${column.header}`}
                      onClick={() => toggleSort(column)}
                    >
                      {column.header}
                      {sort?.id === column.id ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              )
            })}
            {renderDetail ? <th scope="col" className={styles.expandHead} /> : null}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => {
            const key = rowKey(row)
            const isExpanded = expanded.has(key)
            return (
              <Fragment key={key}>
                <tr
                  className={onRowClick ? styles.clickable : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={
                    onRowClick
                      ? (event) => {
                          const target = event.target as HTMLElement
                          if (
                            target.closest('a, button, summary, input, select, textarea, label')
                          ) {
                            return
                          }
                          onRowClick(row)
                        }
                      : undefined
                  }
                  onKeyDown={onRowClick ? (event) => handleRowKey(event, row) : undefined}
                >
                  {columns.map((column) => {
                    const content = column.cell(row)
                    const title =
                      column.title?.(row) ?? (typeof content === 'string' ? content : undefined)
                    const className = [
                      column.ellipsis ? styles.ellipsisCell : '',
                      column.mono ? styles.mono : '',
                      column.nowrap ? styles.nowrap : '',
                    ]
                      .filter(Boolean)
                      .join(' ')
                    return (
                      <td
                        key={column.id}
                        className={className || undefined}
                        style={
                          column.width ? { width: column.width, maxWidth: column.width } : undefined
                        }
                        title={title}
                      >
                        {column.ellipsis ? (
                          <span className={styles.ellipsis}>{content}</span>
                        ) : (
                          content
                        )}
                      </td>
                    )
                  })}
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
      <DataTablePager
        rowCount={rows.length}
        total={total}
        nextCursor={nextCursor}
        onNext={onNext}
        onReset={onReset}
        onPrev={onPrev}
        resetDisabled={resetDisabled}
      />
    </div>
  )
}
