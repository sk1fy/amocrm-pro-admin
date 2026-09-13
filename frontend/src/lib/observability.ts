export function exploreURL(
  base: string | undefined,
  from: string,
  to: string,
  query: string,
): string | undefined {
  if (!base) {
    return undefined
  }
  try {
    const url = new URL(base)
    url.searchParams.set('from', from)
    url.searchParams.set('to', to)
    if (query) {
      url.searchParams.set('query', query)
    }
    return url.toString()
  } catch {
    return undefined
  }
}

export function unixFromRFC3339(value: string | null | undefined): number {
  if (!value) {
    return 0
  }
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) {
    return 0
  }
  return Math.floor(ms / 1000)
}

export function unixFromDateInput(value: string, endOfDay: boolean): number {
  const suffix = endOfDay ? 'T23:59:59Z' : 'T00:00:00Z'
  return unixFromRFC3339(`${value}${suffix}`)
}
