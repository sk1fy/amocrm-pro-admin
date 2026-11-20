import { StatusBadge } from '../src/components/StatusBadge'
import { formatTime } from '../src/lib/format'
import type { parseCompanySource } from './companyApi'
import styles from './Accounts.module.css'

export function CompanySource({ source }: { source: ReturnType<typeof parseCompanySource> }) {
  return (
    <p className={styles.meta}>
      <StatusBadge domain="company_source" state={source.state} calm />
      {source.observed_at ? ' · Воронки обновлены ' + formatTime(source.observed_at) : null}
    </p>
  )
}
