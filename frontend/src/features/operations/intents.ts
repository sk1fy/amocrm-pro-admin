export type CommandIntent = { requestKey: string; operationId?: string }

export function createRequestKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // getRandomValues also works on HTTP development origins without randomUUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function intentStorageKey(employeeId: string, path: string): string {
  return `admin-command:${employeeId}:${path}`
}

export function readIntent(key: string): CommandIntent | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (
      !value ||
      typeof value !== 'object' ||
      !('requestKey' in value) ||
      typeof value.requestKey !== 'string'
    )
      return null
    const operationId =
      'operationId' in value && typeof value.operationId === 'string'
        ? value.operationId
        : undefined
    return { requestKey: value.requestKey, operationId }
  } catch {
    return null
  }
}

export function writeIntent(key: string, intent: CommandIntent | null): void {
  try {
    if (intent) sessionStorage.setItem(key, JSON.stringify(intent))
    else sessionStorage.removeItem(key)
  } catch {
    /* The current component still retains the intent if storage is unavailable. */
  }
}
