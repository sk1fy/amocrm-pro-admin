export type PortraitTopic = {
  id: string
  title: string
  question: string
  placeholder: string
  yesNo?: boolean
  leader?: string
  partner?: boolean
  pro?: boolean
  category?: string
  hint?: string
}

export const portraitTopics: readonly PortraitTopic[] = [
  {
    id: 'calls',
    title: 'Звонки',
    question: 'Слушает ли кто-то звонки менеджеров, есть ли скрипты?',
    placeholder: 'Заметка — что ответил клиент',
    leader: 'Сона',
  },
  {
    id: 'control',
    title: 'Контроль сотрудников и отчёты',
    question: 'Как сейчас контролируете менеджеров, какие отчёты нужны?',
    placeholder: 'Как контролируют, какие отчёты нужны',
    leader: 'наш Контроль активности',
    category: 'Аналитика',
    pro: true,
  },
  {
    id: 'duplicates',
    title: 'Дубли',
    question: 'Есть проблемы с дубликатами?',
    placeholder: 'Откуда берутся дубли, сколько их',
    yesNo: true,
    leader: 'наш Автопоиск дублей',
    category: 'Поиск дублей',
    pro: true,
  },
  {
    id: 'telephony',
    title: 'Телефония',
    question: 'Устраивает текущая телефония?',
    placeholder: 'Что не так, сколько платят, сколько хранятся записи',
    yesNo: true,
    leader: 'МегаФон — сам ведёт клиента',
    partner: true,
    category: 'Телефония',
  },
  {
    id: 'messengers',
    title: 'Мессенджеры',
    question: 'Говорили про Wappi?',
    placeholder: 'Каналы, сервис сейчас, сколько платят, что ответил',
    yesNo: true,
    leader: 'Wappi — «WhatsApp через API», от 1 350 ₽/мес',
    partner: true,
    category: 'Мессенджеры',
  },
  {
    id: 'setup',
    title: 'Кто занимается настройками',
    question: 'Кто у вас настраивает amoCRM?',
    placeholder: 'Сам директор, сотрудник между делом, свой IT, подрядчик',
    hint: 'без продукта — чтобы понимать клиента',
  },
  {
    id: 'automation',
    title: 'Запросы по автоматизации',
    question: 'Есть запросы по автоматизации?',
    placeholder: 'Что хотят автоматизировать',
    yesNo: true,
    hint: 'услуги и доработки — по запросу',
  },
  {
    id: 'license',
    title: 'Лицензия amoCRM',
    question: 'Продлевать amoCRM будут через нас?',
    placeholder: 'Когда продлевают, на сколько пользователей, кто решает и платит',
    yesNo: true,
    hint: 'что предложить — решает менеджер',
  },
]
