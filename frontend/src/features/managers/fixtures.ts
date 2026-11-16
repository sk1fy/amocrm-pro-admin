import type { Section } from './sections'

export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'gray'
export type Cell = string | { text: string; note?: string; tone?: Tone }

export type DemoRow = {
  id: string
  cells: readonly Cell[]
  group?: string
  client?: string
  date?: string
}

type Board = {
  description: string
  columns: readonly string[]
  rows: readonly DemoRow[]
  filters?: readonly string[]
  dateLabel?: string
}

export const clients = [
  {
    id: '91001001',
    domain: 'sever-logistics',
    name: 'Север Логистик',
    till: '2027-03-15',
    tariff: 'Расширенный',
    seats: '14',
    owner: 'Наш клиент',
    updated: 'Сегодня, 10:40',
    health: 'Получаем данные',
    email: 'anna@sever.example.invalid',
  },
  {
    id: '91001002',
    domain: 'atlas-studio',
    name: 'Атлас Студия',
    till: '2027-01-24',
    tariff: 'Базовый',
    seats: '6',
    owner: 'Клиент партнёра',
    updated: 'Сегодня, 09:15',
    health: 'Получаем данные',
    email: 'oleg@atlas.example.invalid',
  },
  {
    id: '91001003',
    domain: 'mayak-service',
    name: 'Маяк Сервис',
    till: '2026-11-30',
    tariff: 'Пробный период',
    seats: '3',
    owner: 'Без партнёра',
    updated: 'Вчера, 16:20',
    health: 'Пробный период',
    email: 'ira@mayak.example.invalid',
  },
  {
    id: '91001004',
    domain: 'volna-group',
    name: 'Волна Групп',
    till: '2026-12-10',
    tariff: 'Базовый',
    seats: '8',
    owner: 'Без партнёра',
    updated: '09.11.2026',
    health: 'Нет данных',
    email: 'lev@volna.example.invalid',
  },
  {
    id: '91001005',
    domain: 'ritm-office',
    name: 'Ритм Офис',
    till: '2026-11-09',
    tariff: 'Базовый',
    seats: '4',
    owner: 'Наш клиент',
    updated: '08.11.2026',
    health: 'Лицензия истекла',
    email: 'olga@ritm.example.invalid',
  },
  {
    id: '91001006',
    domain: 'demo-company',
    name: 'Тестовый аккаунт',
    till: '2027-12-31',
    tariff: 'Технический',
    seats: '2',
    owner: 'Запрет работы',
    updated: 'Сегодня, 08:45',
    health: 'Запрет работы',
    email: 'demo@example.invalid',
  },
]

export const widgets = [
  'Сделки клиента',
  'Копирование в один клик',
  'Возраст сделки',
  'Закрытие задач с результатом',
  'Распределение сделок',
  'Контроль активности',
]

const installationDates = [
  '2026-11-16',
  '2026-11-16',
  '2026-11-15',
  '2026-11-14',
  '2026-11-12',
  '2026-11-10',
]

export const installs = clients.map(
  (client, index): DemoRow => ({
    id: `install-${index + 1}`,
    client: client.id,
    date: installationDates[index],
    group: index < 4 ? 'Непроверенные' : 'Проверенные',
    cells: [
      {
        text: dateLabel(installationDates[index]),
        note: ['10:40', '10:12', '16:20', '14:05', '11:30', '08:45'][index],
      },
      { text: widgets[index], note: index % 2 ? 'FREE' : 'TOP' },
      { text: client.domain, note: client.name },
      client.id,
      {
        text: [
          'Анна Соколова',
          'Олег Миронов',
          'Ирина Белова',
          'Лев Орлов',
          'Ольга Котова',
          'Демо',
        ][index],
        note: client.email,
      },
      index === 0
        ? { text: 'Ждём ввода данных', tone: 'blue' }
        : index === 5
          ? 'Без сделки'
          : `№ 8800${index + 1}`,
    ],
  }),
)

export function dateLabel(value: string) {
  return value.split('-').reverse().join('.')
}

function row(id: string, cells: readonly Cell[], group?: string, client?: string): DemoRow {
  return { id, cells, group, client }
}

export const boards: Record<Section, Board> = {
  installs: {
    description: 'Новые установки виджетов и сделки, которые менеджеру нужно проверить.',
    columns: [
      'Дата установки ↓',
      'Виджет',
      'Аккаунт',
      'ID amoCRM',
      'Контакт',
      'Сделка в rakurscrm',
    ],
    filters: ['Непроверенные', 'Проверенные'],
    dateLabel: 'Дата установки',
    rows: installs,
  },
  clients: {
    description: 'Аккаунты amoCRM, срок лицензии, актуальность данных и принадлежность клиента.',
    columns: [
      'ID amoCRM',
      'Название',
      'amoCRM до',
      'Тариф',
      'Пользователей',
      'Чей клиент',
      'Данные обновлены',
    ],
    filters: [
      'Все',
      'Получаем данные',
      'Нет данных',
      'Лицензия истекла',
      'Запрет работы',
      'Пробный период',
    ],
    dateLabel: 'Лицензия amoCRM до',
    rows: clients.map(
      (client): DemoRow => ({
        id: client.id,
        client: client.id,
        group: client.health,
        date: client.till,
        cells: [
          client.id,
          { text: client.domain, note: client.name },
          dateLabel(client.till),
          client.tariff,
          client.seats,
          client.owner,
          { text: client.updated, note: client.health },
        ],
      }),
    ),
  },
  widgets: {
    description: 'Установки за год, текущая активность и проблемы авторизации.',
    columns: [
      'Виджет',
      'Установки за 12 мес.',
      'Стоят сейчас',
      'Активировали',
      'Требует внимания',
      'Тест · тариф',
    ],
    filters: ['Все виджеты', 'Нет связи'],
    rows: widgets.map((widget, index) =>
      row(
        `widget-${index}`,
        [
          { text: widget, note: index % 2 ? 'FREE' : 'TOP' },
          String(128 - index * 13),
          String(91 - index * 8),
          String(76 - index * 7),
          index % 2 ? { text: 'Нет связи', tone: 'amber' } : '—',
          index % 2 ? 'Бесплатно' : '14 дней · TOP',
        ],
        index % 2 ? 'Нет связи' : undefined,
      ),
    ),
  },
  market: {
    description: 'Интеграции из amoМаркета, встречающиеся в аккаунтах клиентов.',
    columns: [
      'Виджет',
      'Стоит сейчас',
      'Стоял · удалили',
      'Впервые увидели',
      'Отметка',
      'В портрет',
    ],
    rows: [
      row('market-1', [
        { text: 'Телефония', note: 'demo_telephony' },
        '32',
        '8',
        '14.08.2026',
        'Связь',
        'Да',
      ]),
      row('market-2', [
        { text: 'Мессенджеры', note: 'demo_messenger' },
        '24',
        '3',
        '20.08.2026',
        'Коммуникации',
        'Да',
      ]),
      row('market-3', [
        { text: 'Уведомления', note: 'demo_notifications' },
        '16',
        '5',
        '02.09.2026',
        'Автоматизация',
        '—',
      ]),
    ],
  },
  partners: {
    description: 'Партнёры, их клиенты, установки и бонусы.',
    columns: [
      'Партнёр',
      'Принёс денег',
      'Последний платёж',
      'Бонус TOP',
      'Последняя установка',
      'PRO до',
      'Клиентов',
    ],
    rows: [
      row('partner-1', [
        { text: 'Интегратор Север', note: 'partner-sever@example.invalid' },
        '148 000 ₽',
        '12.11.2026',
        { text: 'Доступен', tone: 'green' },
        '16.11.2026',
        '31.03.2027',
        '18',
      ]),
      row('partner-2', [
        { text: 'Точка CRM', note: 'partner-tochka@example.invalid' },
        '86 400 ₽',
        '05.11.2026',
        { text: 'На проверке', tone: 'amber' },
        '15.11.2026',
        '28.02.2027',
        '11',
      ]),
      row('partner-3', [
        { text: 'Парус', note: 'partner-parus@example.invalid' },
        '27 500 ₽',
        '26.10.2026',
        '—',
        '10.11.2026',
        '—',
        '5',
      ]),
    ],
  },
  invoices: {
    description: 'Выставленные счета и выбранный клиентом способ оплаты.',
    columns: ['Счёт', 'Клиент', 'За что', 'Сумма', 'Клиент выбрал', 'Статус'],
    filters: ['Ждём оплату', 'Без движения', 'Оплачены', 'Аннулированы', 'Все'],
    rows: [
      row(
        'invoice-1',
        [
          { text: 'РК-1064', note: '16.11.2026' },
          'Север Логистик',
          'Единая подписка · 12 мес.',
          '24 000 ₽',
          'Банковский перевод',
          { text: 'Ждём оплату', tone: 'blue' },
        ],
        'Ждём оплату',
        '91001001',
      ),
      row(
        'invoice-2',
        [
          { text: 'РК-1060', note: '15.11.2026' },
          'Атлас Студия',
          'Закрытие задач · 6 мес.',
          '6 900 ₽',
          'Счёт для компании',
          { text: 'Ждём оплату', tone: 'blue' },
        ],
        'Ждём оплату',
        '91001002',
      ),
      row(
        'invoice-3',
        [
          { text: 'РК-1053', note: '09.11.2026' },
          'Волна Групп',
          'Лицензия amoCRM',
          '18 000 ₽',
          '—',
          { text: 'Без движения', tone: 'amber' },
        ],
        'Без движения',
        '91001004',
      ),
      row(
        'invoice-4',
        [
          { text: 'РК-1047', note: '06.11.2026' },
          'Ритм Офис',
          'Сделки клиента · 12 мес.',
          '9 900 ₽',
          'Оплата картой',
          { text: 'Оплачен', tone: 'green' },
        ],
        'Оплачены',
        '91001005',
      ),
      row(
        'invoice-5',
        [
          { text: 'РК-1040', note: '04.11.2026' },
          'Маяк Сервис',
          'Виджеты TOP',
          '12 000 ₽',
          '—',
          { text: 'Аннулирован', tone: 'gray' },
        ],
        'Аннулированы',
        '91001003',
      ),
    ],
  },
  payments: {
    description: 'Поступления, продажи виджетов, балансы и клиентские бонусы.',
    columns: ['Дата', 'Клиент или партнёр', 'Операция', 'Сумма', 'Статус'],
    filters: [
      'Поступления',
      'Сгорают бонусы',
      'Оплаты виджетов',
      'Балансы партнёров',
      'Бонусы клиентов',
    ],
    rows: [
      row(
        'payment-1',
        [
          '16.11.2026',
          'Север Логистик',
          'Оплата по счёту',
          '24 000 ₽',
          { text: 'Получено', tone: 'green' },
        ],
        'Поступления',
        '91001001',
      ),
      row(
        'payment-2',
        [
          '15.11.2026',
          'Атлас Студия',
          'Банковский перевод',
          '8 500 ₽',
          { text: 'Получено', tone: 'green' },
        ],
        'Поступления',
        '91001002',
      ),
      row(
        'payment-3',
        [
          '30.11.2026',
          'Маяк Сервис',
          'Окончание срока бонуса',
          '1 200 ₽',
          { text: 'Скоро сгорит', tone: 'amber' },
        ],
        'Сгорают бонусы',
        '91001003',
      ),
      row(
        'payment-4',
        [
          '12.11.2026',
          'Ритм Офис',
          'Сделки клиента · 12 мес.',
          '9 900 ₽',
          { text: 'Оплачено', tone: 'green' },
        ],
        'Оплаты виджетов',
        '91001005',
      ),
      row(
        'payment-5',
        [
          '16.11.2026',
          'Интегратор Север',
          'Доступный баланс',
          '48 200 ₽',
          { text: 'Доступно', tone: 'green' },
        ],
        'Балансы партнёров',
      ),
      row(
        'payment-6',
        [
          '13.11.2026',
          'Волна Групп',
          'Бонус за продление',
          '2 400 ₽',
          { text: 'Начислено', tone: 'blue' },
        ],
        'Бонусы клиентов',
        '91001004',
      ),
    ],
  },
  stats: {
    description: 'Новые аккаунты, установки и доля оплативших.',
    columns: ['Виджет', 'Аккаунтов', 'Оплатили', 'Доля оплативших'],
    rows: widgets.map((widget, index) =>
      row(`stat-${index}`, [
        widget,
        String(100 - index * 10),
        String(33 - index * 3),
        `${33 - index}%`,
      ]),
    ),
  },
  feed: {
    description: 'Последние установки, оплаты и изменения доступа.',
    columns: ['Когда', 'Событие', 'Аккаунт', 'Источник'],
    rows: [
      row(
        'event-1',
        [
          { text: '16.11.2026', note: '10:40' },
          'Установлен виджет «Сделки клиента»',
          'Север Логистик',
          'amoCRM',
        ],
        undefined,
        '91001001',
      ),
      row(
        'event-2',
        [
          { text: '16.11.2026', note: '10:12' },
          'Получена оплата по счёту',
          'Атлас Студия',
          'Оплаты',
        ],
        undefined,
        '91001002',
      ),
      row(
        'event-3',
        [{ text: '15.11.2026', note: '16:20' }, 'Обновлена авторизация', 'Маяк Сервис', 'amoCRM'],
        undefined,
        '91001003',
      ),
    ],
  },
  staff: {
    description: 'Состав команды и примеры доступа к разделам.',
    columns: ['Сотрудник', 'Клиенты', 'Повторные оплаты', 'Партнёры', 'Доступ'],
    rows: [
      row('staff-1', [
        { text: 'Анна Соколова', note: 'anna@example.invalid' },
        'Да',
        '—',
        '—',
        { text: 'Менеджер', tone: 'blue' },
      ]),
      row('staff-2', [
        { text: 'Олег Миронов', note: 'oleg@example.invalid' },
        'Да',
        'Да',
        '—',
        { text: 'Менеджер', tone: 'blue' },
      ]),
      row('staff-3', [
        { text: 'Ирина Белова', note: 'ira@example.invalid' },
        'Да',
        'Да',
        'Да',
        { text: 'Администратор', tone: 'green' },
      ]),
    ],
  },
}
