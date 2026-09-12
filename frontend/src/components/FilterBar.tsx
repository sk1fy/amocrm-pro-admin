import type { FormEvent, ReactNode } from 'react'
import styles from './FilterBar.module.css'

type Props = {
  children: ReactNode
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
}

export function FilterBar({ children, onSubmit }: Props) {
  return (
    <form className={styles.form} onSubmit={onSubmit}>
      {children}
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
