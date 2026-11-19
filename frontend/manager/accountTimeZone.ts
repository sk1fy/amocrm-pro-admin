function zoneOffset(timeZone: string, date: Date) {
  const offset = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value
  if (offset === 'GMT') return 0
  const parts = offset?.match(/^GMT([+-])(\d{2}):(\d{2})$/)
  if (!parts) return null
  return (parts[1] === '-' ? -1 : 1) * (Number(parts[2]) * 60 + Number(parts[3]))
}

export function moscowOffset(timeZone: string | null | undefined, snapshot: string) {
  if (!timeZone) return null
  try {
    const date = new Date(snapshot)
    const account = zoneOffset(timeZone, date)
    const moscow = zoneOffset('Europe/Moscow', date)
    if (account === null || moscow === null || account === moscow) return null
    const minutes = Math.abs(account - moscow)
    const hours = Math.floor(minutes / 60)
    const fraction = minutes % 60
    const sign = account > moscow ? '+' : '−'
    return sign + hours + (fraction ? ':' + String(fraction).padStart(2, '0') : '') + ' МСК'
  } catch (error) {
    if (error instanceof RangeError) return null
    throw error
  }
}
