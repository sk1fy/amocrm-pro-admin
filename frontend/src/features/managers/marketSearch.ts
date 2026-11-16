import type { MarketMark } from './marketFixtures'

export const marketSortColumns = [
  ['name', 'Виджет'],
  ['accounts', 'Стоит сейчас'],
  ['removed', 'Стоял — удалили'],
  ['firstSeen', 'Впервые увидели'],
] as const

type MarketSortColumn = (typeof marketSortColumns)[number][0]

export type MarketFilters = {
  mark: MarketMark | ''
  category: string
  query: string
  column: MarketSortColumn
  ascending: boolean
}

export const defaultMarketFilters: MarketFilters = {
  mark: '',
  category: '',
  query: '',
  column: 'accounts',
  ascending: false,
}

export function parseMarketFilters(value: unknown): MarketFilters | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { mark, category, query, column, ascending } = value as Record<string, unknown>
  return {
    mark: mark === 'unknown' || mark === 'partner' || mark === 'ours' ? mark : '',
    category: typeof category === 'string' ? category : '',
    query: typeof query === 'string' ? query : '',
    column: marketSortColumns.find(([key]) => key === column)?.[0] ?? defaultMarketFilters.column,
    ascending: ascending === true,
  }
}
