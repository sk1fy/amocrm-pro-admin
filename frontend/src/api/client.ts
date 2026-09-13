import type { ApiErrorBody } from './types'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string

  constructor(status: number, code: string, message: string, requestId: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

type UnauthorizedHandler = (next: string) => void

let unauthorizedHandler: UnauthorizedHandler | null = null
let sessionController = new AbortController()

export function resetApiSession(): void {
  sessionController.abort()
  sessionController = new AbortController()
}

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

export function isUnauthorized(error: unknown): boolean {
  return isApiError(error) && error.status === 401
}

export function isForbidden(error: unknown): boolean {
  return isApiError(error) && error.status === 403
}

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`
}

async function parseError(response: Response): Promise<ApiError> {
  const requestId = response.headers.get('X-Request-ID') ?? ''
  try {
    const body = (await response.json()) as ApiErrorBody
    if (body && typeof body === 'object' && body.error) {
      return new ApiError(
        response.status,
        body.error.code || 'internal',
        body.error.message || 'ошибка запроса',
        body.error.request_id || requestId,
      )
    }
  } catch {
    // envelope missing
  }
  return new ApiError(response.status, 'internal', 'ошибка запроса', requestId)
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const signal = init.signal
    ? AbortSignal.any([init.signal, sessionController.signal])
    : sessionController.signal
  const headers = new Headers(init.headers)
  const method = (init.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('X-Requested-With', 'admin-ui')
    if (init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
  }
  const response = await fetch(path, {
    ...init,
    signal,
    headers,
    credentials: 'include',
  })
  signal.throwIfAborted()
  if (response.status === 401) {
    const error = await parseError(response)
    signal.throwIfAborted()
    if (!path.startsWith('/api/v1/auth/login')) {
      unauthorizedHandler?.(currentPath())
    }
    throw error
  }
  if (!response.ok) {
    throw await parseError(response)
  }
  if (response.status === 204) {
    return undefined as T
  }
  const data = (await response.json()) as T
  signal.throwIfAborted()
  return data
}

export function apiGet<T>(path: string): Promise<T> {
  return apiFetch<T>(path)
}

export function apiSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') {
      continue
    }
    search.set(key, String(value))
  }
  const encoded = search.toString()
  return encoded === '' ? '' : `?${encoded}`
}
