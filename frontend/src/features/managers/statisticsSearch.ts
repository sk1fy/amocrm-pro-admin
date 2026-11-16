export const statisticsPresets = {
  30: '30 дней',
  90: '3 месяца',
  182: '6 месяцев',
  365: 'год',
} as const

export const statisticsTrialFilters = {
  running: { label: 'тест идёт', hint: 'на сегодня · ещё не оплатили' },
  ending: { label: 'кончается за 7 дней', hint: 'на сегодня · позвонить сейчас' },
  expired: { label: 'истёк без оплаты', hint: 'за период · денег не было' },
  paid: { label: 'оплачено деньгами', hint: 'за период · первая оплата после теста' },
}

export type StatisticsTrialFilter = keyof typeof statisticsTrialFilters
type StatisticsDays = keyof typeof statisticsPresets

export type StatisticsFilters = {
  days: StatisticsDays
  from: string
  to: string
  split: boolean
  trial?: StatisticsTrialFilter
}

export const defaultStatisticsFilters: StatisticsFilters = {
  days: 90,
  from: '',
  to: '',
  split: false,
}

function dateInput(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  const parsed = new Date(value)
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value ? value : ''
}

export function parseStatisticsFilters(value: unknown): StatisticsFilters | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const days = source.days
  const trial = source.trial
  return {
    days:
      days === 30 || days === 90 || days === 182 || days === 365
        ? days
        : defaultStatisticsFilters.days,
    from: dateInput(source.from),
    to: dateInput(source.to),
    split: source.split === true,
    trial:
      typeof trial === 'string' && Object.hasOwn(statisticsTrialFilters, trial)
        ? (trial as StatisticsTrialFilter)
        : undefined,
  }
}
