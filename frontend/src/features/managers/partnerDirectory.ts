import { boards } from './fixtures'

export type Partner = {
  id: string
  name: string
  accounts: string[]
  proTill: string
  bonus: number
  approved: boolean
  promos: string[]
  request: string
  operations: string[]
  legal: string
  contact: string
  phones: string[]
  email: string
  inn: string
  login?: string
  loginAge?: string
  proTrial?: boolean
  telegram?: boolean
  money?: number
  paymentCount?: number
  lastPayment?: readonly [date: string, amount: number]
  lastWidgetPayment?: string
  lastInstall?: readonly [date: string, widget: string]
  directoryClientCount?: number
}

export const partnerDirectoryDate = '2026-11-06'

const groupNames = [
  'Интегратор',
  'Внедрение',
  'Автоматизация',
  'Цифровые продажи',
  'Бизнес',
  'Сделка',
  'Клиентский',
  'Воронка',
  'Решения',
  'Логика',
  'Процесс',
  'Эксперт',
  'Система',
  'Рост',
  'Точка',
]
const suffixes = [
  'Про',
  'Плюс',
  'Групп',
  'Лаб',
  'Сервис',
  'Консалт',
  'Студия',
  '24',
  'Онлайн',
  'Центр',
  'Мастер',
  'Профи',
  'Альянс',
  'Технологии',
  'Систем',
]
const cities = ['', 'Москва', 'Казань', 'Екатеринбург', 'Новосибирск']
const contacts = [
  'Алексей',
  'Мария',
  'Иван',
  'Ольга',
  'Денис',
  'Анна',
  'Сергей',
  'Елена',
  'Павел',
  'Юлия',
]

const profiles: Partial<Partner>[] = [
  {
    name: 'Интегратор Про',
    contact: 'Олег',
    phones: ['+7 (921) 555-10-20', '+7 (921) 555-10-21'],
    inn: '7700007910',
    bonus: 5000,
    proTill: '2026-10-27',
    telegram: true,
    login: '2026-11-06',
    loginAge: '0 мин назад',
    money: 20000,
    paymentCount: 1,
    lastPayment: ['2025-10-27', 20000],
    lastInstall: ['2026-11-04', 'Сделки клиента'],
    accounts: [
      '31421329',
      '31642103',
      '30467412',
      '30364700',
      '30160243',
      '30330441',
      '30653106',
      '30025824',
    ],
  },
  {
    name: 'CRM-Мастерская',
    contact: 'Елена',
    phones: ['+7 (912) 555-31-44', '+7 (912) 555-31-45', '+7 (912) 555-31-46'],
    inn: '7700015830',
    bonus: 10000,
    proTill: '2026-11-24',
    telegram: true,
    login: '2026-11-05',
    loginAge: '29 ч назад',
    lastInstall: ['2026-09-15', 'Закрытие задачи с результатом'],
    accounts: ['30454597', '31613951', '31173031', '30121103', '31074829', '30977114'],
  },
  {
    name: 'АмоЭксперт',
    contact: 'Денис',
    phones: ['+7 (903) 555-77-01'],
    inn: '7700023750',
    bonus: 4000,
    proTill: '2026-11-15',
    proTrial: true,
    login: '2026-11-04',
    lastInstall: ['2026-10-27', 'Возраст сделки'],
    accounts: ['30628676', '31020583', '31892112', '31844120'],
  },
  {
    name: 'Сделай CRM',
    contact: 'Ксения',
    phones: ['+7 (916) 555-02-93'],
    inn: '7700031670',
    proTill: '2027-06-08',
    login: '2026-09-23',
    lastInstall: ['2026-10-28', 'Возраст сделки'],
    accounts: ['31472819', '31961116', '31019322', '30832626'],
  },
  {
    phones: ['+7 (915) 515-45-75'],
    login: '2026-07-21',
    money: 8000,
    paymentCount: 2,
    lastPayment: ['2026-05-11', 5000],
    lastWidgetPayment: '2026-05-11',
    directoryClientCount: 8,
  },
  {
    phones: ['+7 (916) 516-52-88'],
    inn: '7700047511',
    login: '2026-09-05',
    money: 11000,
    paymentCount: 2,
    lastPayment: ['2026-04-20', 5000],
    lastWidgetPayment: '2026-04-20',
  },
  {
    phones: ['+7 (917) 517-59-12'],
    inn: '7700055431',
    login: '2026-09-18',
    money: 6000,
    paymentCount: 1,
    lastPayment: ['2026-09-15', 6000],
    lastWidgetPayment: '2026-09-15',
  },
]

export function makePartner(id: string, name: string, contact = ''): Partner {
  return {
    id,
    name,
    contact,
    accounts: [],
    proTill: '',
    bonus: 0,
    approved: true,
    promos: [],
    request: '',
    operations: [],
    legal: '',
    phones: [],
    email: '',
    inn: '',
  }
}

const legacyPartners = boards.partners.rows.map(
  (row, i): Partner => ({
    ...makePartner(row.id, typeof row.cells[0] === 'string' ? row.cells[0] : row.cells[0].text),
    accounts: i === 0 ? ['91001002'] : i === 1 ? ['91001005'] : [],
    proTill: i === 2 ? '' : '2027-03-31',
    bonus: i === 0 ? 48200 : 1200,
    approved: i !== 1,
    request: i === 1 ? 'Доступ TOP' : '',
    email: typeof row.cells[0] === 'object' ? (row.cells[0].note ?? '') : '',
  }),
)

// The first directory page follows the handoff. The older cabinet scenarios
// retain their own stable identities and remain searchable in the directory.
export const seedPartners = [
  ...Array.from({ length: 1000 - legacyPartners.length }, (_, i): Partner => {
    const id = i + 1
    const index = Math.max(0, i - 4)
    const group = groupNames[Math.floor(index / suffixes.length) % groupNames.length]
    const suffix = suffixes[index % suffixes.length]
    const city = cities[Math.floor(index / (groupNames.length * suffixes.length))]
    return {
      ...makePartner(
        `directory-${id}`,
        `${group} ${suffix}${city ? ', ' + city : ''}`,
        contacts[id % contacts.length],
      ),
      phones: [
        `+7 (000) 100-${String(id)
          .padStart(4, '0')
          .replace(/(..)(..)$/, '$1-$2')}`,
      ],
      email: `crm-${id}@partners.example.invalid`,
      ...profiles[i],
    }
  }),
  ...legacyPartners,
]

export type PartnerRequest = {
  id: string
  partner: string
  account: string
  widget: string
  created: string
  status: 'pending' | 'allowed' | 'denied'
  previousAmount: number
  previousDate: string
  previousSource: string
  decidedBy?: string
  decidedAt?: string
}

export const partnerPaymentRequests: PartnerRequest[] = [
  {
    id: 'partner-payment-1',
    partner: 'directory-1',
    account: '31421329',
    widget: 'Сделки клиента',
    created: '2026-11-05',
    status: 'pending',
    previousAmount: 120000,
    previousDate: '2026-11-01',
    previousSource: 'Сделка rakurscrm',
  },
  {
    id: 'partner-payment-2',
    partner: 'directory-1',
    account: '31642103',
    widget: 'Закрытие задачи с результатом',
    created: '2026-11-02',
    status: 'allowed',
    previousAmount: 10000,
    previousDate: '2026-05-20',
    previousSource: 'Виджет',
    decidedBy: 'Максим',
    decidedAt: '2026-11-03',
  },
]

type PartnerWidget = readonly [
  partner: number,
  account: string,
  widget: string,
  until: string,
  coverage: string,
]

const deals = 'Сделки клиента'
const tasks = 'Закрытие задачи с результатом'
export const partnerWidgets: readonly PartnerWidget[] = [
  [1, '31421329', deals, '2027-12-05', 'сделка AMO'],
  [1, '31642103', tasks, '2027-01-04', 'тест 90 дней'],
  [1, '30467412', deals, '2027-02-26', 'тест 90 дней'],
  [2, '31244311', deals, '2027-02-06', 'по подписке'],
  [3, '30628676', tasks, '2026-11-21', 'тест 90 дней'],
  [2, '31613951', deals, '2027-10-10', 'партнёр'],
  [2, '31173031', tasks, '2026-12-14', 'тест 90 дней'],
  [43, '31013022', deals, '2027-09-29', 'сделка AMO'],
  [1, '30653106', deals, '2026-11-21', 'тест 90 дней'],
  [2, '30121103', deals, '2026-09-07', 'тест истёк'],
  [4, '31961116', deals, '2027-09-03', 'партнёр'],
  [1, '30025824', tasks, '2027-09-07', 'сделка AMO'],
  [86, '31702305', tasks, '2027-08-31', 'сделка AMO'],
  [2, '31074829', tasks, '2027-10-27', 'сделка AMO'],
  [3, '31892112', tasks, '2027-10-08', 'сделка AMO'],
  [4, '31019322', deals, '2026-11-09', 'тест 90 дней'],
  [86, '31021205', tasks, '2027-10-26', 'сделка AMO'],
  [2, '30977114', tasks, '2027-10-27', 'сделка AMO'],
  [4, '30832626', deals, '2027-01-03', 'тест 90 дней'],
]
