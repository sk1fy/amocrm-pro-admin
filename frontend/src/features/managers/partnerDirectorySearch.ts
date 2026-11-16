export const partnerSort = [
  ['', 'как в справочнике'],
  ['money', 'больше принёс денег'],
  ['pay', 'недавно платил'],
  ['payOld', 'давно не платил'],
  ['inst', 'свежие установки'],
  ['instOld', 'давно не ставили'],
  ['pro', 'PRO: скоро закончится'],
  ['login', 'недавно заходили'],
  ['loginOld', 'давно не заходили'],
] as const

export const partnerPeriods = [
  ['expired', 'Истекли'],
  ['7', '≤ 7 дней'],
  ['30', '≤ 30 дней'],
  ['90', '≤ 90 дней'],
  ['all', 'Все'],
] as const

export type PartnerDirectorySearch = {
  tab: 'directory' | 'widgets'
  sort: (typeof partnerSort)[number][0]
  period: (typeof partnerPeriods)[number][0]
  query: string
  widgetQuery: string
}

export const defaultPartnerFilters: PartnerDirectorySearch = {
  tab: 'directory',
  sort: '',
  period: '30',
  query: '',
  widgetQuery: '',
}

export function parsePartnerDirectory(value: unknown): PartnerDirectorySearch | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>
  return {
    tab: input.tab === 'widgets' ? 'widgets' : 'directory',
    sort: partnerSort.find(([key]) => key === input.sort)?.[0] ?? '',
    period: partnerPeriods.find(([key]) => key === input.period)?.[0] ?? '30',
    query: typeof input.query === 'string' ? input.query : '',
    widgetQuery: typeof input.widgetQuery === 'string' ? input.widgetQuery : '',
  }
}
