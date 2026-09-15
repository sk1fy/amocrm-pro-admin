import type { FormEvent, ReactNode } from 'react'
import styles from './FilterBar.module.css'

export type FilterChip = {
  id: string
  label: string
  value: string
}

type Props = {
  children: ReactNode
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
  onReset?: () => void
  chips?: FilterChip[]
  onRemoveChip?: (id: string) => void
}

export function FilterBar({ children, onSubmit, onReset, chips = [], onRemoveChip }: Props) {
  const activeCount = chips.length
  return (
    <form className={styles.form} onSubmit={onSubmit} aria-label="Фильтры">
      <div className={styles.controls}>{children}</div>
      <p className={styles.hint}>Списки применяются сразу. Поиск — по кнопке «Найти».</p>
      {onReset || activeCount > 0 ? (
        <div className={styles.toolbar}>
          {activeCount > 0 ? (
            <p className={styles.count} aria-live="polite">
              Активных фильтров: {activeCount}
            </p>
          ) : (
            <p className={styles.count}>Нет активных фильтров</p>
          )}
          {onReset ? (
            <button type="button" onClick={onReset} disabled={activeCount === 0}>
              Сбросить фильтры
            </button>
          ) : null}
        </div>
      ) : null}
      {chips.length > 0 ? (
        <ul className={styles.chips} aria-label="Активные фильтры">
          {chips.map((chip) => (
            <li key={chip.id} className={styles.chip}>
              <span>
                {chip.label}: {chip.value}
              </span>
              {onRemoveChip ? (
                <button
                  type="button"
                  className={styles.chipRemove}
                  onClick={() => onRemoveChip(chip.id)}
                  aria-label={`Снять фильтр ${chip.label}`}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  )
}

export function FilterField({
  label,
  children,
  grow,
}: {
  label: string
  children: ReactNode
  grow?: boolean
}) {
  return (
    <label className={grow ? styles.fieldGrow : styles.field}>
      <span>{label}</span>
      {children}
    </label>
  )
}
