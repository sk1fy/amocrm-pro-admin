import { parseStatisticsFilters, type StatisticsFilters } from './statisticsSearch'
import { parsePaymentFilters, type PaymentFilters } from './paymentsSearch'
import { parsePartnerDirectory, type PartnerDirectorySearch } from './partnerDirectorySearch'
import { parseInvoiceFilters, type InvoiceFilters } from './invoiceSearch'
import { parseMarketFilters, type MarketFilters } from './marketSearch'
import { parseDirectorySearch, type ClientDirectorySearch } from './clientDirectorySearch'

export const sections = {
  installs: {
    title: 'Установки',
    hint: 'новые и проверенные, карточки аккаунтов',
    icon: 'download',
  },
  clients: { title: 'Клиенты', hint: 'аккаунты: amoCRM до, тариф, чей клиент', icon: 'clients' },
  widgets: { title: 'Виджеты', hint: 'список, установки, проблемы', icon: 'grid' },
  market: { title: 'amoМаркет', hint: 'виджеты из Маркета у наших клиентов', icon: 'bag' },
  partners: { title: 'Партнёры', hint: 'справочник, запросы на оплату', icon: 'case' },
  invoices: { title: 'Счета', hint: 'выставить счёт, ссылка на оплату', icon: 'file' },
  payments: { title: 'Оплаты', hint: 'деньги, продажи, балансы, бонусы', icon: 'money' },
  stats: { title: 'Статистика', hint: 'рейтинги, динамика, тесты', icon: 'chart' },
  feed: { title: 'Лента событий', hint: 'всё по всем аккаунтам', icon: 'feed' },
  staff: { title: 'Сотрудники', hint: 'люди и доступ по блокам', icon: 'person' },
} as const

export type Section = keyof typeof sections

export const widgetTiers = ['FREE', 'TOP', 'PRO'] as const
export type WidgetTier = (typeof widgetTiers)[number]

export const widgetSorts = {
  installs: 'Больше установок',
  active: 'Больше стоят сейчас',
  growth: 'Рост за 30 дней',
  problems: 'Сначала проблемные',
  fresh: 'Сначала новые',
  name: 'По названию',
} as const

export type WidgetSort = keyof typeof widgetSorts

export type WidgetFilters = {
  tier: 'all' | WidgetTier
  sort: WidgetSort
  query: string
  problems: boolean
  scale: boolean
}

export const defaultWidgetFilters: WidgetFilters = {
  tier: 'all',
  sort: 'installs',
  query: '',
  problems: false,
  scale: true,
}

function parseWidgetFilters(value: unknown): WidgetFilters | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const filters = value as Record<string, unknown>
  return {
    tier: widgetTiers.find((tier) => tier === filters.tier) ?? defaultWidgetFilters.tier,
    sort:
      typeof filters.sort === 'string' && Object.hasOwn(widgetSorts, filters.sort)
        ? (filters.sort as WidgetSort)
        : defaultWidgetFilters.sort,
    query: typeof filters.query === 'string' ? filters.query : '',
    problems: filters.problems === true,
    scale: filters.scale !== false,
  }
}

function isSection(value: unknown): value is Section {
  return typeof value === 'string' && Object.hasOwn(sections, value)
}

export function managersSearch(search: Record<string, unknown>): {
  section: Section
  client: string | undefined
  mode?: 'partner'
  view?: string
  market?: string
  directory?: ClientDirectorySearch
  partner?: string
  partnerDirectory?: PartnerDirectorySearch
  widgetCatalog?: WidgetFilters
  marketCatalog?: MarketFilters
  invoiceFilters?: InvoiceFilters
  invoice?: string
  paymentFilters?: PaymentFilters
  statisticsFilters?: StatisticsFilters
} {
  const { section, client } = search
  return {
    statisticsFilters:
      section === 'stats' ? parseStatisticsFilters(search.statisticsFilters) : undefined,
    paymentFilters: section === 'payments' ? parsePaymentFilters(search.paymentFilters) : undefined,
    invoiceFilters: section === 'invoices' ? parseInvoiceFilters(search.invoiceFilters) : undefined,
    invoice:
      section === 'invoices' && typeof search.invoice === 'string' ? search.invoice : undefined,
    marketCatalog: section === 'market' ? parseMarketFilters(search.marketCatalog) : undefined,
    widgetCatalog: section === 'widgets' ? parseWidgetFilters(search.widgetCatalog) : undefined,
    partnerDirectory:
      section === 'partners' ? parsePartnerDirectory(search.partnerDirectory) : undefined,
    partner:
      typeof search.partner === 'string' &&
      /^(?:partner-[1-3]|directory-\d{1,4}|new-partner-\d{1,5})$/.test(search.partner)
        ? search.partner
        : undefined,
    mode: search.mode === 'partner' ? 'partner' : undefined,
    view: typeof search.view === 'string' ? search.view : undefined,
    market: typeof search.market === 'string' ? search.market : undefined,
    directory: section === 'clients' ? parseDirectorySearch(search.directory) : undefined,
    section: isSection(section) ? section : 'installs',
    client:
      typeof client === 'string' || (typeof client === 'number' && Number.isSafeInteger(client))
        ? String(client)
        : undefined,
  }
}
