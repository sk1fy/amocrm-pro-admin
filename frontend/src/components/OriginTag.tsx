import { StatusBadge } from './StatusBadge'

/**
 * Real data is the norm and carries no mark; fixture or unknown origin is
 * always labelled so test data never mixes in silently (states.md,
 * «Происхождение данных»; ADR-0021).
 */
export function OriginTag({ origin }: { origin: string | null | undefined }) {
  if (origin === 'real') {
    return null
  }
  return <StatusBadge domain="origin" state={origin} />
}
