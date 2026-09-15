import page from './page.module.css'
import styles from './PageSkeleton.module.css'

type Variant = 'page' | 'dashboard' | 'list' | 'detail'

type Props = {
  label: string
  variant?: Variant
}

export function PageSkeleton({ label, variant = 'page' }: Props) {
  return (
    <div className={page.page} role="status" aria-live="polite" aria-busy="true">
      <p className={page.muted}>{label}</p>
      {variant === 'dashboard' ? <DashboardSkeleton /> : null}
      {variant === 'list' ? <ListSkeleton /> : null}
      {variant === 'detail' ? <DetailSkeleton /> : null}
      {variant === 'page' ? <PageBlocks /> : null}
    </div>
  )
}

function PageBlocks() {
  return (
    <>
      <div className={styles.hero} />
      <div className={styles.row}>
        <div className={styles.chip} />
        <div className={styles.chip} />
        <div className={styles.chip} />
      </div>
      <div className={styles.block} />
      <div className={styles.block} />
      <div className={styles.block} />
    </>
  )
}

function DashboardSkeleton() {
  return (
    <>
      <div className={styles.hero} />
      <div className={styles.metrics}>
        <div className={styles.metric} />
        <div className={styles.metric} />
        <div className={styles.metric} />
        <div className={styles.metric} />
      </div>
      <div className={styles.row}>
        <div className={styles.card} />
        <div className={styles.card} />
        <div className={styles.card} />
      </div>
      <div className={styles.block} />
      <div className={styles.block} />
    </>
  )
}

function ListSkeleton() {
  return (
    <>
      <div className={styles.hero} />
      <div className={styles.row}>
        <div className={styles.chip} />
        <div className={styles.chip} />
        <div className={styles.chip} />
        <div className={styles.chip} />
      </div>
      <div className={styles.table}>
        <div className={styles.line} />
        <div className={styles.line} />
        <div className={styles.line} />
        <div className={styles.line} />
        <div className={styles.line} />
      </div>
    </>
  )
}

function DetailSkeleton() {
  return (
    <>
      <div className={styles.hero} />
      <div className={styles.dl}>
        <div className={styles.line} />
        <div className={styles.line} />
        <div className={styles.line} />
        <div className={styles.line} />
      </div>
      <div className={styles.block} />
      <div className={styles.block} />
    </>
  )
}
