import { formatNull } from '../../lib/format'
import { jobLabel } from '../../lib/labels'

/**
 * Human name of a job type. The code goes to the tooltip (ADR-0021); a type
 * without a description keeps its code, otherwise every unknown job would
 * read the same «Фоновая задача».
 */
export function jobTitle(type: string): string {
  const label = jobLabel(type)
  return label === jobLabel('') ? formatNull(type) : label
}
