/** Russian plural form: one (1, 21), few (2–4, 22–24), many (0, 5–20, 25…). */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return one
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few
  }
  return many
}

export function connectionsCountLabel(count: number): string {
  if (count === 0) {
    return 'нет подключений'
  }
  return `${count} ${plural(count, 'подключение', 'подключения', 'подключений')}`
}
