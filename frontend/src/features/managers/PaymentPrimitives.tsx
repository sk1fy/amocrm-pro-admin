import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { defaultPaymentFilters, type PaymentFilters } from './paymentsSearch'
import styles from './PaymentsBoard.module.css'

export type ChangeFilters = (patch: Partial<PaymentFilters>) => void
type SummaryProps = {
  value: ReactNode
  label: string
  note?: ReactNode
  warning?: boolean
  active?: boolean
  onClick?: () => void
}

export function PaymentSummary({ value, label, note, warning, active, onClick }: SummaryProps) {
  const body = (
    <>
      <strong>{value}</strong>
      <span>{label}</span>
      {note && <small>{note}</small>}
    </>
  )
  return onClick ? (
    <button
      type="button"
      className={styles.summary}
      data-warning={warning}
      aria-pressed={active}
      onClick={onClick}
    >
      {body}
    </button>
  ) : (
    <div className={styles.summary} data-warning={warning}>
      {body}
    </div>
  )
}

export function PaymentTable({
  columns,
  children,
}: {
  columns: readonly string[]
  children: ReactNode
}) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to scroll the table.
    <div className={styles.tableClip} role="region" aria-label="Таблица оплат" tabIndex={0}>
      <table>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th scope="col" aria-label={column || 'Действия'} key={column || index}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function EmptyPaymentRows({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={columns} className={styles.empty}>
        {children}
      </td>
    </tr>
  )
}

export function PaymentFiltersBar({
  filters,
  change,
  label,
  placeholder,
  hidePeriod,
  children,
}: {
  filters: PaymentFilters
  change: ChangeFilters
  label: string
  placeholder: string
  hidePeriod?: boolean
  children?: ReactNode
}) {
  return (
    <div className={styles.filters}>
      {!hidePeriod && (
        <>
          <label>
            Период с{' '}
            <input
              aria-label="Период с"
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => change({ from: e.target.value })}
            />
          </label>
          <label>
            по{' '}
            <input
              aria-label="Период по"
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => change({ to: e.target.value })}
            />
          </label>
        </>
      )}
      {children}
      {(['from', 'to', 'method', 'state', 'source', 'means', 'q'] as const).some(
        (key) => filters[key] !== defaultPaymentFilters[key],
      ) ? (
        <button
          type="button"
          onClick={() =>
            change({
              ...defaultPaymentFilters,
              tab: filters.tab,
              review: filters.review,
              ledger: filters.ledger,
            })
          }
        >
          Сбросить
        </button>
      ) : null}
      <input
        className={styles.search}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={filters.q}
        onChange={(e) => change({ q: e.target.value })}
      />
    </div>
  )
}

export function PaymentSelect<T extends string>({
  title,
  value,
  options,
  change,
}: {
  title: string
  value: T | ''
  options: Record<T, string>
  change: (value: T | '') => void
}) {
  return (
    <label>
      {title}
      <select aria-label={title} value={value} onChange={(e) => change(e.target.value as T | '')}>
        <option value="">все</option>
        {Object.keys(options).map((key) => (
          <option key={key} value={key}>
            {options[key as T]}
          </option>
        ))}
      </select>
    </label>
  )
}

export function receiptInPeriod(record: { date: string }, filters: PaymentFilters) {
  return (
    (!filters.from || record.date >= filters.from) && (!filters.to || record.date <= filters.to)
  )
}

export function ClientPaymentLink({ client, children }: { client: string; children: ReactNode }) {
  return (
    <Link
      className={styles.payer}
      to="/managers"
      search={(previous) => ({ ...previous, section: 'payments', client })}
    >
      {children}
    </Link>
  )
}
