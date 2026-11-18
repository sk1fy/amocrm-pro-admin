export const directoryBuckets = ['all', 'green', 'red', 'inactive', 'banned', 'trial'] as const
export type DirectoryBucket = (typeof directoryBuckets)[number]

export const portraitConditions = {
  unknown: 'не узнали — ни ответа, ни заметки',
  yes: 'ответ «да»',
  no: 'ответ «нет»',
  told: 'теплота: рассказали',
  installed: 'теплота: стоит',
  shown: 'теплота: показали',
  using: 'теплота: пользуется',
  cold: 'теплоты нет — ещё ничего не было',
  audited: 'был аудит',
  unaudited: 'аудита не было',
  expires: 'скоро истечёт или недавно истекла лицензия amoCRM',
  noFree: 'нет ни одного FREE',
} as const

export type PortraitCondition = keyof typeof portraitConditions
export type PortraitFilter = {
  topic: string
  condition: '' | PortraitCondition
  niche: string
  query: string
  from: string
  to: string
}

export type ClientDirectorySearch = {
  bucket?: DirectoryBucket
  query?: string
  from?: string
  to?: string
  tariff?: string
  owner?: string
  renewal?: string
  portrait?: PortraitFilter
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function asDate(value: unknown) {
  const date = asText(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''
}

export function parseDirectorySearch(value: unknown): ClientDirectorySearch | undefined {
  if (!isRecord(value)) return undefined
  const bucket = directoryBuckets.find((key) => key === value.bucket)
  const raw = value.portrait
  const portrait = isRecord(raw)
    ? {
        topic: asText(raw.topic),
        condition:
          (Object.keys(portraitConditions) as PortraitCondition[]).find(
            (key) => key === raw.condition,
          ) ?? ('' as const),
        niche: asText(raw.niche),
        query: asText(raw.query),
        from: asDate(raw.from),
        to: asDate(raw.to),
      }
    : undefined
  return {
    bucket,
    query: asText(value.query) || undefined,
    from: asDate(value.from) || undefined,
    to: asDate(value.to) || undefined,
    tariff: asText(value.tariff) || undefined,
    owner: asText(value.owner) || undefined,
    renewal: asText(value.renewal) || undefined,
    portrait,
  }
}
