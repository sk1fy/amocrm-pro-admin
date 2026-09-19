import type { Verification } from '../api/types'
import { formatTime } from '../lib/format'
import { StatusBadge } from './StatusBadge'

export function VerificationBadge({
  verification,
  unavailable = false,
}: {
  verification?: Verification | null
  unavailable?: boolean
}) {
  const state = unavailable
    ? 'unavailable'
    : !verification || verification.freshness === 'unknown'
      ? 'unknown'
      : verification.freshness === 'stale'
        ? 'stale'
        : verification.classification
  return (
    <span
      title={`Проверка amoCRM: ${formatTime(verification?.observed_at)}. Срок актуальности: ${verification?.fresh_for_seconds ? verification.fresh_for_seconds / 60 : '—'} мин.`}
    >
      <StatusBadge domain="verification" state={state} raw={verification?.raw} />
    </span>
  )
}
