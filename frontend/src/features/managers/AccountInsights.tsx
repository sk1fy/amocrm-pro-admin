import { useState, type FormEvent } from 'react'
import { Panel, Table } from './AccountPanel'
import { formatDate, type DemoClient } from './accountFixtures'
import styles from './AccountPanels.module.css'

const topics = [
  {
    title: 'Звонки',
    question: 'Кто слушает звонки менеджеров? Есть ли скрипты?',
    product: 'Телефония',
  },
  {
    title: 'Контроль сотрудников и отчёты',
    question: 'Как руководитель контролирует работу команды?',
    product: 'Контроль активности',
  },
  {
    title: 'Дубли',
    question: 'Есть ли проблемы с дубликатами контактов?',
    product: 'Автопоиск дублей',
  },
  {
    title: 'Сделки клиента',
    question: 'Видят ли менеджеры все сделки с клиентом?',
    product: 'Сделки клиента',
  },
  {
    title: 'Задачи',
    question: 'Как команда следит за сроками задач?',
    product: 'Закрытие задач с результатом',
  },
  {
    title: 'Распределение заявок',
    question: 'Кто распределяет новые обращения?',
    product: 'Распределение сделок',
  },
  {
    title: 'Регламенты и обучение',
    question: 'Где команда хранит инструкции?',
    product: 'База знаний',
  },
  {
    title: 'Оплаты',
    question: 'Как выставляют счета и проверяют оплату?',
    product: 'Счета в amoCRM',
  },
]

const crmFeatures = [
  'Воронка под продажи',
  'Заявки подтягиваются',
  'Мессенджеры',
  'Телефония',
  'Работают с задачами',
  'Нет сделок без задач',
  'Salesbot и автоматизации',
  'Отчёты руководителю',
  'Контроль качества',
  'Контроль дублей',
  'Регламенты и обучение',
  'Счета из amoCRM',
  'Эквайринг',
]

function Choices({ title, options }: { title: string; options: readonly string[] }) {
  const [value, setValue] = useState('')
  return (
    <fieldset className={styles.choices}>
      <legend>{title}</legend>
      <div className={styles.chips}>
        {options.map((option) => (
          <button
            type="button"
            aria-pressed={value === option}
            key={option}
            onClick={() => setValue(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

type Person = { id: number; name: string; phone: string; role: string }

export function Portrait({
  client,
  answered,
  setAnswered,
}: {
  client: DemoClient
  answered: number
  setAnswered: (count: number) => void
}) {
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [people, setPeople] = useState<Person[]>([])
  const [audit, setAudit] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)

  function addPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    const name = String(fields.get('name') ?? '').trim()
    if (!name) return
    setPeople((previous) => [
      ...previous,
      {
        id: previous.length + 1,
        name,
        phone: String(fields.get('phone') ?? '').trim(),
        role: String(fields.get('role') ?? ''),
      },
    ])
    form.reset()
  }

  return (
    <Panel
      title="Портрет клиента"
      hint="Что знаем о клиенте по темам. Черновики хранятся до выхода из карточки."
      action={
        <button
          type="button"
          aria-expanded={templateOpen}
          onClick={() => setTemplateOpen((open) => !open)}
        >
          Шаблон тем
        </button>
      }
    >
      {templateOpen ? (
        <p className={styles.bordered}>{topics.map((topic) => topic.title).join(' · ')}</p>
      ) : null}
      <div className={styles.portraitGrid}>
        <div>
          <h3>О компании</h3>
          <label>
            Ниша
            <input
              placeholder="Укажите нишу"
              defaultValue={client.domain === 'sever-logistics' ? 'Логистика' : ''}
            />
          </label>
          <label>
            Сайт
            <input type="url" placeholder="Ссылка на сайт" />
          </label>
          <Choices title="Оценка бюджета" options={['1', '2', '3', '4', '5', 'Не знаем']} />
        </div>
        <div>
          <Choices title="Менеджеры работают" options={['В офисе', 'В полях', 'Неизвестно']} />
          <Choices title="Клиенты компании" options={['B2B', 'B2C', 'B2B + B2C', 'Неизвестно']} />
          <div className={styles.chips}>
            <button type="button" aria-pressed={audit} onClick={() => setAudit((done) => !done)}>
              {audit ? 'Аудит проведён' : '+ Провели аудит'}
            </button>
          </div>
        </div>
        <fieldset className={styles.checklist}>
          <legend>amoCRM настроена</legend>
          {crmFeatures.map((feature) => (
            <label key={feature}>
              <input type="checkbox" />
              {feature}
            </label>
          ))}
        </fieldset>
      </div>
      <div className={styles.bordered}>
        <h3>
          Люди <small>{people.length}</small>
        </h3>
        {people.length ? (
          <ul className={styles.people}>
            {people.map((person) => (
              <li key={person.id}>
                <strong>{person.name}</strong> · {person.role}
                {person.phone ? ` · ${person.phone}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>Контакты для портрета пока не добавлены.</p>
        )}
        <form className={styles.peopleForm} onSubmit={addPerson}>
          <label>
            Имя
            <input name="name" required />
          </label>
          <label>
            Телефон
            <input type="tel" name="phone" />
          </label>
          <label>
            Роль
            <select name="role">
              <option>ЛПР</option>
              <option>ЛВР</option>
              <option>Счета</option>
              <option>Настройка</option>
            </select>
          </label>
          <button type="submit" data-variant="primary">
            Добавить человека
          </button>
        </form>
      </div>
      <div className={styles.topicHead}>
        <strong>Темы клиента</strong>{' '}
        <span>
          Узнали {answered} из {topics.length}
        </span>
      </div>
      {topics.map((topic, index) => (
        <section key={topic.title} className={styles.topic}>
          <div>
            <h3>
              {index + 1}. {topic.title}
            </h3>
            <p className={styles.muted}>{topic.question}</p>
          </div>
          <textarea
            aria-label={`Заметка: ${topic.title}`}
            rows={2}
            placeholder="Заметка по теме"
            value={notes[topic.title] ?? ''}
            onChange={(event) => {
              const next = { ...notes, [topic.title]: event.target.value }
              setNotes(next)
              setAnswered(Object.values(next).filter((note) => note.trim()).length)
            }}
          />
          <div>
            <small className={styles.muted}>Подходящий продукт</small>
            <strong className={styles.productName}>{topic.product}</strong>
            <Choices
              title={`Статус: ${topic.title}`}
              options={['Рассказали', 'Стоит', 'Показали', 'Пользуется']}
            />
          </div>
        </section>
      ))}
    </Panel>
  )
}

const funnelStages = [
  'Неразобранное',
  'Новая сделка',
  'Распределение',
  'Первый контакт',
  'Интерес подтверждён',
  'Ожидает решения',
  'Назначена встреча',
  'Успешно реализовано',
  'Закрыто и не реализовано',
]

const pipelineDeals = [
  { date: '2026-11-04', stage: 'Новая сделка', amount: 18000 },
  { date: '2026-11-06', stage: 'Первый контакт', amount: 24000 },
  { date: '2026-11-10', stage: 'Интерес подтверждён', amount: 16000 },
  { date: '2026-11-11', stage: 'Успешно реализовано', amount: 42000 },
  { date: '2026-11-14', stage: 'Закрыто и не реализовано', amount: 27000 },
  { date: '2026-11-19', stage: 'Успешно реализовано', amount: 33000 },
]

const money = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
})
const pipelineColumns = [
  'Этап',
  'Кол-во (созд.)',
  'Сумма (созд.)',
  'Кол-во (закр.)',
  'Сумма (закр.)',
]

export function Audit({ client, showPortrait }: { client: DemoClient; showPortrait: () => void }) {
  const [calls, setCalls] = useState(client.health === 'Получаем данные')
  const [duplicates, setDuplicates] = useState(false)
  const [range, setRange] = useState({ from: '2026-11-01', to: '2026-11-30' })
  const [period, setPeriod] = useState<typeof range | null>(null)
  const deals = period
    ? pipelineDeals.filter(({ date }) => date >= period.from && date <= period.to)
    : []
  const rows = funnelStages.map((stage) => {
    const atStage = deals.filter((deal) => deal.stage === stage)
    const sum = atStage.reduce((total, deal) => total + deal.amount, 0)
    const closed = stage === 'Успешно реализовано' || stage === 'Закрыто и не реализовано'
    return {
      id: stage,
      cells: [
        stage,
        period ? String(atStage.length) : '—',
        period ? money.format(sum) : '—',
        period ? String(closed ? atStage.length : 0) : '—',
        period ? money.format(closed ? sum : 0) : '—',
      ],
    }
  })

  return (
    <div className={styles.stack}>
      <Panel
        title="Аудит клиента"
        hint="Звонки, дубли контактов и воронки на демо-данных."
        action={
          <button type="button" data-variant="primary" onClick={() => setCalls(true)}>
            Собрать данные
          </button>
        }
      >
        <div className={styles.bordered}>
          <h3>Звонки</h3>
          {calls ? (
            <div className={styles.callsGrid}>
              <div className={styles.callMetric}>
                <small>В среднем за месяц</small>
                <strong>742 звонка</strong>
                <strong>1 039 минут</strong>
              </div>
              <Table
                columns={['Показатель', 'Август', 'Сентябрь', 'Октябрь']}
                rows={[
                  { id: 'calls', cells: ['Звонки', '726', '742', '758'] },
                  { id: 'minutes', cells: ['Минуты', '1 016', '1 039', '1 062'] },
                ]}
              />
              <div className={styles.auditTip}>
                <span>Обсудите телефонию с клиентом. В демо около 1 000 минут в месяц.</span>
                <button type="button" onClick={showPortrait}>
                  Портрет → «Звонки»
                </button>
              </div>
            </div>
          ) : (
            <p className={styles.muted}>Сводку звонков ещё не собирали.</p>
          )}
        </div>
      </Panel>
      <Panel
        title="Дубли контактов"
        hint="Сравнение нормализованных телефонов и адресов почты."
        action={
          <button type="button" data-variant="primary" onClick={() => setDuplicates(true)}>
            Проверить дубли
          </button>
        }
      >
        <p className={styles.bordered} role="status">
          {duplicates
            ? 'Демо-проверка: 3 группы по телефону, 1 группа по электронной почте.'
            : 'Проверки ещё не было.'}
        </p>
      </Panel>
      <Panel
        title="Воронки amoCRM"
        hint="Количество и сумма созданных и закрытых сделок за период."
      >
        <form
          className={styles.peopleForm}
          onSubmit={(event) => {
            event.preventDefault()
            setPeriod(range)
          }}
        >
          <label>
            Дата с
            <input
              type="date"
              value={range.from}
              max={range.to || undefined}
              required
              onChange={(event) => setRange({ ...range, from: event.target.value })}
            />
          </label>
          <label>
            Дата по
            <input
              type="date"
              value={range.to}
              min={range.from || undefined}
              required
              onChange={(event) => setRange({ ...range, to: event.target.value })}
            />
          </label>
          <button type="submit">Загрузить по периоду</button>
        </form>
        <details className={styles.funnel} open>
          <summary>
            Воронка{' '}
            <small>
              {period
                ? `${formatDate(period.from)} – ${formatDate(period.to)} · ${deals.length} сделок`
                : 'Выберите период, чтобы увидеть итог'}
            </small>
          </summary>
          <Table
            columns={pipelineColumns}
            rows={[
              ...rows,
              {
                id: 'total',
                cells: [
                  'Итого',
                  period ? String(deals.length) : '—',
                  period ? money.format(deals.reduce((sum, deal) => sum + deal.amount, 0)) : '—',
                  period
                    ? String(
                        deals.filter(
                          (deal) =>
                            deal.stage === 'Успешно реализовано' ||
                            deal.stage === 'Закрыто и не реализовано',
                        ).length,
                      )
                    : '—',
                  period
                    ? money.format(
                        deals
                          .filter(
                            (deal) =>
                              deal.stage === 'Успешно реализовано' ||
                              deal.stage === 'Закрыто и не реализовано',
                          )
                          .reduce((sum, deal) => sum + deal.amount, 0),
                      )
                    : '—',
                ],
              },
            ]}
          />
        </details>
        <details className={styles.funnel}>
          <summary>Онлайн</summary>
          <p className={styles.empty}>Для этой воронки в демо нет записей.</p>
        </details>
      </Panel>
    </div>
  )
}
