import { useState, type FormEvent, type ReactNode } from 'react'
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
  /** Secondary filters, folded under «Ещё фильтры» (ADR-0021). */
  more?: ReactNode
  /** Opens the secondary filters, e.g. when one of them is active. */
  moreOpen?: boolean
  /** Extra controls on the right of the main row (saved views etc.). */
  aside?: ReactNode
}

export function FilterBar({
  children,
  onSubmit,
  onReset,
  chips = [],
  onRemoveChip,
  more,
  moreOpen = false,
  aside,
}: Props) {
  // Opens when a secondary filter becomes active; closing stays the user's
  // choice, so clearing a filter does not snap the panel shut under them.
  const [open, setOpen] = useState(moreOpen)
  const [wasActive, setWasActive] = useState(moreOpen)
  if (moreOpen !== wasActive) {
    setWasActive(moreOpen)
    if (moreOpen) setOpen(true)
  }
  return (
    <form className={styles.form} onSubmit={onSubmit} aria-label="Фильтры">
      <div className={styles.controls}>
        {children}
        {aside ? <div className={styles.aside}>{aside}</div> : null}
      </div>
      {more ? (
        <details
          className={styles.more}
          open={open}
          onToggle={(event) => setOpen(event.currentTarget.open)}
        >
          <summary>Ещё фильтры</summary>
          <div className={styles.controls}>{more}</div>
        </details>
      ) : null}
      {chips.length > 0 ? (
        <div className={styles.toolbar}>
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
          {onReset ? (
            <button type="button" data-variant="ghost" onClick={onReset}>
              Сбросить фильтры
            </button>
          ) : null}
        </div>
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
