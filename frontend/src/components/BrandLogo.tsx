import styles from './BrandLogo.module.css'

export function BrandLogo({ className }: { className?: string }) {
  return (
    <svg
      className={[styles.mark, className].filter(Boolean).join(' ')}
      viewBox="0 0 79 79"
      fill="none"
      aria-hidden="true"
    >
      <rect x="13" y="41" width="13" height="22" rx="3" fill="#fff" opacity=".35" />
      <rect x="33" y="31" width="13" height="32" rx="3" fill="#fff" opacity=".65" />
      <rect x="53" y="13" width="13" height="50" rx="3" fill="#5cc4bf" />
    </svg>
  )
}
