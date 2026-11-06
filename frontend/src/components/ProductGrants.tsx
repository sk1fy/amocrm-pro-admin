import type { Grant } from '../api/types'
import { StatusBadge } from './StatusBadge'
import styles from './ProductGrants.module.css'

export function productLabel(service: string): string {
  return service === 'activity' ? 'Контроль активности 2.0' : service
}

/**
 * Products as a plain list (ADR-0021): a granted product is the norm and
 * needs no badge; a missing or unknown grant keeps its mark.
 */
export function ProductGrants({ grants }: { grants: Grant[] | undefined }) {
  if (grants === undefined) {
    return <StatusBadge domain="freshness" state="unknown" />
  }
  if (grants.length === 0) {
    return <span className={styles.none}>Нет продуктов</span>
  }
  return (
    <ul className={styles.list}>
      {grants.map((grant) => (
        <li key={grant.service} className={styles.item}>
          <span title={grant.service}>{productLabel(grant.service)}</span>
          {grant.state === 'granted' ? null : (
            <StatusBadge domain="grant" state={grant.state} raw={grant.raw} />
          )}
        </li>
      ))}
    </ul>
  )
}
