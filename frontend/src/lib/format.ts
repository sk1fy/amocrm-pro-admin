export const EMPTY = '—'

export function formatNull(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return EMPTY
  }
  if (typeof value === 'number') {
    return String(value)
  }
  if (value === '') {
    return EMPTY
  }
  return value
}

export function formatTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') {
    return EMPTY
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return EMPTY
  }
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

export function formatTimeOnly(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') {
    return EMPTY
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return EMPTY
  }
  return new Intl.DateTimeFormat('ru-RU', { timeStyle: 'short' }).format(date)
}

export function hostFromRedirect(uri: string | null | undefined): string {
  if (uri === null || uri === undefined || uri === '') {
    return EMPTY
  }
  try {
    return new URL(uri).host || EMPTY
  } catch {
    return uri
  }
}

export function safeNextPath(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) {
    return '/'
  }
  return next
}
