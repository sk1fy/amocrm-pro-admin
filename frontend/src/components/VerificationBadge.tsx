import type { Verification } from '../api/types'
import { formatTime } from '../lib/format'
import { StatusBadge } from './StatusBadge'

export function verificationState(
  verification?: Verification | null,
  unavailable = false,
): string | undefined {
  if (unavailable) {
    return 'unavailable'
  }
  if (!verification || verification.freshness === 'unknown') {
    return 'unknown'
  }
  if (verification.freshness === 'stale') {
    return 'stale'
  }
  return verification.classification
}

export function verificationTooltip(verification?: Verification | null): string {
  return `Проверка amoCRM: ${formatTime(verification?.observed_at)}. Срок актуальности: ${verification?.fresh_for_seconds ? verification.fresh_for_seconds / 60 : '—'} мин.`
}

export function VerificationBadge({
  verification,
  unavailable = false,
  variant,
  calm,
}: {
  verification?: Verification | null
  unavailable?: boolean
  variant?: 'badge' | 'text' | 'dot'
  calm?: boolean
}) {
  return (
    <span title={verificationTooltip(verification)}>
      <StatusBadge
        domain="verification"
        state={verificationState(verification, unavailable)}
        raw={verification?.raw}
        variant={variant}
        calm={calm}
      />
    </span>
  )
}
