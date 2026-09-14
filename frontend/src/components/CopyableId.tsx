import { useState } from 'react'
import { shortenId } from '../lib/format'
import styles from './CopyableId.module.css'

type Props = {
  value: string
  label: string
}

export function CopyableId({ value, label }: Props) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <span className={styles.wrap}>
      <code className={styles.value} title={value}>
        {shortenId(value)}
      </code>
      <button
        type="button"
        className={styles.copy}
        onClick={() => void copy()}
        aria-label={`Копировать ${label}`}
      >
        Копировать
      </button>
      <span className={styles.status} role="status" aria-live="polite">
        {copied ? 'ID скопирован' : ''}
      </span>
    </span>
  )
}
