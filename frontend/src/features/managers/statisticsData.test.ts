import { describe, expect, it } from 'vitest'
import { initialState } from './DemoSession'
import { statisticsData } from './statisticsData'
import { defaultStatisticsFilters } from './statisticsSearch'

describe('manager statistics snapshot', () => {
  it('counts new accounts and unique widget installations separately', () => {
    const data = statisticsData(initialState(), defaultStatisticsFilters)

    expect(data.range).toEqual({ from: '2026-08-09', to: '2026-11-06' })
    expect(data.newAccountCount).toBe(55)
    expect(data.widgetRanks.map(({ value }) => value)).toEqual([23, 20, 19, 16])
    expect(data.installationWeeks).toHaveLength(26)
  })

  it('keeps inclusive custom dates and preserves weekly totals when splitting by widget', () => {
    const state = initialState()
    const filters = {
      ...defaultStatisticsFilters,
      from: '2026-11-04',
      to: '2026-11-06',
    }
    const aggregate = statisticsData(state, filters)
    const split = statisticsData(state, { ...filters, split: true })

    expect(split.newAccountCount).toBe(3)
    expect(split.widgetRanks.map(({ value }) => value)).toEqual([1, 1, 1, 0])
    expect(split.installationWeeks.map(({ values }) => values.reduce((a, b) => a + b, 0))).toEqual(
      aggregate.installationWeeks.map(({ values }) => values[0]),
    )
  })
})
