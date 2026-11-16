export type PartnerCabinetFilters = {
  query?: string
  from?: string
  to?: string
}

function date(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

export function parsePartnerCabinet(value: unknown): PartnerCabinetFilters | undefined {
  if (!value || typeof value !== 'object') return undefined
  const filters = value as Record<string, unknown>
  return {
    query: typeof filters.query === 'string' ? filters.query : undefined,
    from: date(filters.from),
    to: date(filters.to),
  }
}
