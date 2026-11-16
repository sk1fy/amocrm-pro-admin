import { widgetTiers, type WidgetTier } from './sections'

export type WidgetTariff = {
  name: string
  months: number
  price: number
  perUser: boolean
}

export type WidgetSettings = {
  name: string
  tier: WidgetTier
  trial: number
  trialExtension: number
  installUrl: string
  guideUrl: string
  tariffs: WidgetTariff[]
  archived: boolean
}

type WidgetStats = {
  installations: number
  active: number
  monthly: number[]
  activation: number
  notActivated: number
  lost: number
  recent: number
}

export type CatalogWidget = WidgetSettings & {
  code: string
  version: string
  demo: boolean
  releasedMonth: number
  stats: WidgetStats
}

export const activationThreshold = 90
export const widgetMonths = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, index - 1, 1)),
  ),
)

export const defaultWidgetTariff = (tier: WidgetTier): WidgetTariff =>
  tier === 'FREE'
    ? { name: 'Бесплатно', months: 120, price: 0, perUser: false }
    : { name: '1 год', months: 12, price: tier === 'TOP' ? 10_000 : 25_000, perUser: false }

const defaultSettings = (name: string, tier: WidgetTier): WidgetSettings => ({
  name,
  tier,
  trial: tier === 'FREE' ? 0 : tier === 'TOP' ? 90 : 14,
  trialExtension: 7,
  installUrl: '',
  guideUrl: '',
  tariffs: [defaultWidgetTariff(tier)],
  archived: false,
})

// The four releases in the reference catalog have a fixed historical series.
const releases: ReadonlyArray<{
  code: string
  name: string
  tier: WidgetTier
  version: string
  installationLink: boolean
  stats: WidgetStats
}> = [
  {
    code: 'rkrs_deal_age',
    name: 'Возраст сделки',
    tier: 'FREE',
    version: '1.2.0',
    installationLink: true,
    stats: {
      installations: 52,
      active: 49,
      monthly: [0, 0, 0, 0, 0, 4, 16, 10, 11, 3, 7, 1],
      activation: 98,
      notActivated: 1,
      lost: 0,
      recent: 7,
    },
  },
  {
    code: 'rkrs_quick_copy',
    name: 'Копирование в один клик',
    tier: 'FREE',
    version: '1.0.4',
    installationLink: false,
    stats: {
      installations: 66,
      active: 59,
      monthly: [0, 0, 0, 0, 0, 11, 14, 15, 10, 7, 8, 1],
      activation: 98,
      notActivated: 1,
      lost: 0,
      recent: 6,
    },
  },
  {
    code: 'rkrs_client_deals',
    name: 'Сделки клиента',
    tier: 'TOP',
    version: '1.3.1',
    installationLink: true,
    stats: {
      installations: 49,
      active: 44,
      monthly: [0, 0, 0, 0, 0, 4, 13, 13, 9, 2, 6, 2],
      activation: 100,
      notActivated: 0,
      lost: 1,
      recent: 6,
    },
  },
  {
    code: 'rkrs_task_result',
    name: 'Закрытие задачи с результатом',
    tier: 'TOP',
    version: '1.1.0',
    installationLink: false,
    stats: {
      installations: 58,
      active: 53,
      monthly: [0, 0, 0, 0, 0, 8, 10, 15, 15, 4, 4, 2],
      activation: 98,
      notActivated: 1,
      lost: 2,
      recent: 6,
    },
  },
]

export const widgetCatalog: CatalogWidget[] = releases.map(
  ({ name, tier, code, version, installationLink, stats }) => ({
    ...defaultSettings(name, tier),
    code,
    version,
    demo: false,
    releasedMonth: -1,
    stats,
    installUrl: installationLink ? `https://catalog.example.invalid/${code}/install` : '',
    guideUrl: `https://catalog.example.invalid/${code}/guide`,
  }),
)

const sampleNames: Record<WidgetTier, readonly string[]> = {
  PRO: [
    'Контроль активности',
    'Автопоиск дублей 2.0',
    'Google Документы',
    'Аналитика в Google Таблицах',
    'Массовые рассылки',
    'Склейка контактов',
    'Сквозная аналитика звонков',
    'Планы продаж',
  ],
  TOP: [
    'Распределение сделок 2.0',
    'Оповещения в Telegram',
    'Цветные сделки',
    'Динамические поля',
    'Счётчик недозвонов',
    'Дата перехода в статус',
    'Первый звонок',
    'Процессы',
    'Копирование сделок',
    'Копирование полей',
    'История клиента',
    'Чек-листы задач',
    'Запрет сделок без задач',
    'Обязательные поля на этапе',
    'Автозадачи по этапам',
    'Контроль просроченных задач',
    'Шаблоны ответов',
    'Причины отказа',
    'Повторные продажи',
    'Счета из сделки',
    'Расчёт скидки',
    'Рабочий график менеджеров',
  ],
  FREE: [
    'DaData',
    'Время клиента',
    'Написать в Telegram',
    'Написать в WhatsApp',
    'Удобные поля',
    'Поиск в поле со списком',
    'Адрес на карте',
    'Кнопка Salesbot',
    'День рождения клиента',
    'Таймер сделки',
    'Курс валют в сделке',
    'Ссылка на карточку',
    'Номер сделки в названии',
    'Быстрые заметки',
    'Погода у клиента',
    'Склонение ФИО',
  ],
}

function generateScaledCatalog(): CatalogWidget[] {
  let seed = 4242
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const samples = widgetTiers
    .slice()
    .reverse()
    .flatMap((tier) => sampleNames[tier].map((name) => ({ tier, name })))

  return samples.map(({ name, tier }, index) => {
    const code = `demo_${index}`
    const age = 1 + Math.floor(random() * 30)
    const popularity = { FREE: 40, TOP: 22, PRO: 9 }[tier]
    const monthly = widgetMonths.map((_, month) =>
      month < 12 - age ? 0 : Math.round(popularity * (0.3 + random() * 1.4) * (0.6 + month / 18)),
    )
    const olderInstallations = age > 12 ? Math.round(popularity * (age - 12) * 0.5) : 0
    const installations = monthly.reduce((sum, count) => sum + count, olderInstallations)
    const active = Math.round(installations * (0.55 + random() * 0.35))
    const activation = tier === 'FREE' ? 0.93 + random() * 0.07 : 0.86 + random() * 0.14
    const version = `1.${Math.floor(random() * 6)}.${Math.floor(random() * 9)}`
    const installUrl = random() < 0.92 ? `https://catalog.example.invalid/${code}/install` : ''
    const guideUrl = random() < 0.9 ? `https://catalog.example.invalid/${code}/guide` : ''
    const lost = random() < 0.18 ? 1 + Math.floor(random() * 3) : 0

    return {
      ...defaultSettings(name, tier),
      code,
      version,
      installUrl,
      guideUrl,
      demo: true,
      releasedMonth: age <= 12 ? 12 - age : -1,
      stats: {
        installations,
        active,
        monthly,
        activation: Math.round(activation * 100),
        notActivated: Math.round(installations * (1 - activation) * 0.15),
        lost,
        recent: monthly[11] + Math.round(monthly[10] * 0.3),
      },
    }
  })
}

export const scaledCatalog = [...widgetCatalog, ...generateScaledCatalog()]
