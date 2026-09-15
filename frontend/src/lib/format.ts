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

function parseDate(iso: string | null | undefined): Date | null {
  if (iso === null || iso === undefined || iso === '') {
    return null
  }
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

export function sameInstant(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = parseDate(left)
  const b = parseDate(right)
  if (!a || !b) {
    return false
  }
  return a.getTime() === b.getTime()
}

export function shortenId(value: string): string {
  if (value.length <= 16) {
    return value
  }
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) {
    return EMPTY
  }
  const abs = Math.abs(Math.trunc(seconds))
  const hours = Math.floor(abs / 3600)
  const minutes = Math.floor((abs % 3600) / 60)
  const rest = abs % 60
  if (hours > 0) {
    return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`
  }
  if (minutes > 0) {
    return rest > 0 ? `${minutes} мин ${rest} сек` : `${minutes} мин`
  }
  return `${rest} сек`
}

export function formatRelativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  const date = parseDate(iso)
  if (!date) {
    return EMPTY
  }
  const diffMs = now.getTime() - date.getTime()
  const future = diffMs < 0
  const sec = Math.round(Math.abs(diffMs) / 1000)
  if (sec < 10) {
    return future ? 'скоро' : 'только что'
  }
  if (sec < 60) {
    return future ? `через ${sec} с` : `${sec} с назад`
  }
  const min = Math.round(sec / 60)
  if (min < 60) {
    return future ? `через ${min} мин` : `${min} мин назад`
  }
  const hours = Math.round(min / 60)
  if (hours < 24) {
    return future ? `через ${hours} ч` : `${hours} ч назад`
  }
  const days = Math.round(hours / 24)
  if (days < 14) {
    return future ? `через ${days} дн.` : `${days} дн. назад`
  }
  return formatTime(iso)
}

export function formatExpiry(iso: string | null | undefined, now: Date = new Date()): string {
  const date = parseDate(iso)
  if (!date) {
    return EMPTY
  }
  if (date.getTime() <= now.getTime()) {
    return `Срок истёк ${formatRelativeTime(iso, now)}`
  }
  return `Истекает ${formatRelativeTime(iso, now)}`
}

export function formatDateLong(iso: string | null | undefined): string {
  const date = parseDate(iso)
  if (!date) {
    return EMPTY
  }
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatAttempts(
  attempts: number | null | undefined,
  max: number | null | undefined,
): string {
  if (attempts === null || attempts === undefined || max === null || max === undefined) {
    return EMPTY
  }
  return `${attempts} из ${max} попыток`
}
