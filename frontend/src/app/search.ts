export function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

export function numberParam(value: unknown, fallback?: number): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

export type AccountsSearch = {
  q?: string
  product?: string
  connection?: string
  problem?: string
  origin?: string
  cursor?: string
  limit?: number
}

export function accountsSearch(search: Record<string, unknown>): AccountsSearch {
  return {
    q: stringParam(search.q),
    product: stringParam(search.product),
    connection: stringParam(search.connection),
    problem: stringParam(search.problem),
    origin: stringParam(search.origin),
    cursor: stringParam(search.cursor),
    limit: numberParam(search.limit, 25),
  }
}

export type CursorSearch = {
  cursor?: string
  status?: string
  type?: string
  backend?: string
  employee?: string
  action?: string
}

export function cursorSearch(search: Record<string, unknown>): CursorSearch {
  return {
    cursor: stringParam(search.cursor),
    status: stringParam(search.status),
    type: stringParam(search.type),
    backend: stringParam(search.backend),
    employee: stringParam(search.employee),
    action: stringParam(search.action),
  }
}
