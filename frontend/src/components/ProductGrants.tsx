import type { Grant } from '../api/types'
import { StatusBadge } from './StatusBadge'

export function productLabel(service: string): string {
  return service === 'activity' ? 'Контроль активности 2.0' : service
}

export function ProductGrants({ grants }: { grants: Grant[] | undefined }) {
  if (grants === undefined) {
    return <StatusBadge domain="freshness" state="unknown" />
  }
  if (grants.length === 0) {
    return <span>Нет грантов</span>
  }
  return (
    <ul>
      {grants.map((grant) => (
        <li key={grant.service}>
          <span title={grant.service}>{productLabel(grant.service)}</span>:{' '}
          <StatusBadge domain="grant" state={grant.state} raw={grant.raw} />
        </li>
      ))}
    </ul>
  )
}
