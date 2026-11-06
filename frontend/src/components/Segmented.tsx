import styles from './Segmented.module.css'

export type SegmentOption = {
  label: string
  value: string | undefined
}

/**
 * Quick filter as a row of toggle buttons (ADR-0021: the most used filter in
 * one click, the rest in selects). The value lives in the URL like any filter.
 */
export function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: SegmentOption[]
  value: string | undefined
  onChange: (value: string | undefined) => void
}) {
  return (
    <div className={styles.group} role="group" aria-label={label}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.label}
            type="button"
            className={active ? `${styles.option} ${styles.active}` : styles.option}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
