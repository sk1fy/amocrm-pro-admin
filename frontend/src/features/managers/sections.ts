export const sections = {
  installs: { title: 'Установки', hint: 'Новые подключения и проверка сделок', icon: 'download' },
  clients: { title: 'Клиенты', hint: 'Аккаунты amoCRM и их подключения', icon: 'clients' },
  widgets: { title: 'Виджеты', hint: 'Установки, активации и авторизация', icon: 'grid' },
  market: { title: 'amoМаркет', hint: 'Виджеты, которые используют клиенты', icon: 'bag' },
  partners: { title: 'Партнёры', hint: 'Клиенты, оплаты и бонусы партнёров', icon: 'case' },
  invoices: { title: 'Счета', hint: 'Выставленные счета и статусы оплаты', icon: 'file' },
  payments: { title: 'Оплаты', hint: 'Поступления, продажи и бонусы', icon: 'money' },
  stats: { title: 'Статистика', hint: 'Динамика аккаунтов и установок', icon: 'chart' },
  feed: { title: 'Лента событий', hint: 'Установки, оплаты и изменения доступа', icon: 'feed' },
  staff: { title: 'Сотрудники', hint: 'Состав команды и доступы', icon: 'person' },
} as const

export type Section = keyof typeof sections

function isSection(value: unknown): value is Section {
  return typeof value === 'string' && Object.hasOwn(sections, value)
}

export function managersSearch(search: Record<string, unknown>) {
  const { section, client } = search
  return {
    section: isSection(section) ? section : 'installs',
    client:
      typeof client === 'string' || (typeof client === 'number' && Number.isSafeInteger(client))
        ? String(client)
        : undefined,
  }
}
