import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useAccountDraft } from './AccountDrafts'
import { Panel } from './AccountPanel'
import { formatDate, type DemoClient } from './accountFixtures'
import type { DemoRow } from './fixtures'
import { marketMarkLabels, marketWidgets, type MarketSetting } from './marketFixtures'
import type { PortraitTopic } from './portraitTopics'
import { PortraitTemplate } from './PortraitTemplate'
import styles from './Portrait.module.css'

const niches = [
  'Автомобили',
  'Логистика',
  'Медицина',
  'Недвижимость',
  'Образование',
  'Производство',
  'Розничная торговля',
  'Строительство',
  'Услуги',
]

const crmFeatures = [
  { label: 'Воронка под их продажи', observed: true },
  { label: 'Заявки подтягиваются' },
  { label: 'Мессенджеры', observed: true },
  { label: 'Телефония', observed: true },
  { label: 'Работают с задачами' },
  { label: 'Нет сделок без задач' },
  { label: 'Salesbot и автоматизации' },
  { label: 'Отчёты руководителю' },
  { label: 'Контроль качества' },
  { label: 'Контроль дублей' },
  { label: 'Регламенты и обучение' },
  { label: 'Счета из amoCRM' },
  { label: 'Эквайринг' },
]

function Choices({
  label,
  options,
  onChange,
}: {
  label: string
  options: readonly string[]
  onChange?: (value: string) => void
}) {
  const [value, setValue] = useAccountDraft(`choice:${label}`, options.at(-1))
  return (
    <div className={styles.choices} role="group" aria-label={label}>
      {options.map((option, index) => (
        <button
          type="button"
          aria-pressed={value === option}
          data-unknown={index === options.length - 1}
          key={option}
          onClick={() => {
            setValue(option)
            onChange?.(option)
          }}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

function Company({ client }: { client: DemoClient }) {
  const nicheId = useId()
  const nicheOptionsId = useId()
  const [showNiches, setShowNiches] = useState(false)
  const [niche, setNiche] = useAccountDraft(
    'niche',
    client.domain === 'sever-logistics' ? 'Логистика' : '',
  )
  const [audit, setAudit] = useAccountDraft('audit', false)
  const [features, setFeatures] = useAccountDraft<string[]>('features', [])
  return (
    <div className={styles.columns}>
      <div>
        <h3 className={styles.label}>О компании</h3>
        <div className={styles.field}>
          <div className={styles.split}>
            <label className={styles.label} htmlFor={nicheId}>
              Ниша
            </label>
            <button
              type="button"
              className={styles.link}
              aria-expanded={showNiches}
              onClick={() => setShowNiches((open) => !open)}
            >
              справочник · {niches.length}
            </button>
          </div>
          <input
            id={nicheId}
            list={nicheOptionsId}
            placeholder="начните вводить — подскажу из справочника"
            value={niche}
            onChange={(event) => setNiche(event.target.value)}
          />
          <datalist id={nicheOptionsId}>
            {niches.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          {showNiches ? (
            <div className={styles.choiceList} aria-label="Справочник ниш">
              {niches.map((item) => (
                <button
                  type="button"
                  key={item}
                  onClick={() => {
                    setNiche(item)
                    setShowNiches(false)
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <label className={styles.field}>
          <span className={styles.label}>Сайт</span>
          <input type="url" placeholder="ссылка на сайт" />
        </label>
        <div className={styles.field}>
          <span className={styles.label}>Деньги</span>
          <Choices
            label="Деньги у компании, от 1 до 5"
            options={['1', '2', '3', '4', '5', 'не знаем']}
          />
          <small>Оценим по аудиту (сделки, средний чек) или после созвона.</small>
        </div>
      </div>
      <div className={styles.companyMiddle}>
        <div className={styles.field}>
          <span className={styles.label}>Менеджеры работают</span>
          <Choices label="Менеджеры работают" options={['в офисе', 'в полях', 'неизвестно']} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Клиенты компании</span>
          <Choices label="Клиенты компании" options={['B2B', 'B2C', 'B2B + B2C', 'неизвестно']} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Аудит</span>
          <div className={styles.audit}>
            <button type="button" aria-pressed={audit} onClick={() => setAudit((done) => !done)}>
              {audit ? 'Аудит проведён' : '+ Провели аудит'}
            </button>
            <small className={styles.hint}>
              {audit ? 'отмечено в демо' : 'аудит не проводили'}
            </small>
          </div>
        </div>
      </div>
      <div>
        <h3 className={styles.label}>amoCRM настроена · наш взгляд</h3>
        <div className={styles.tags}>
          {crmFeatures.map(({ label, observed }) => (
            <button
              type="button"
              key={label}
              aria-pressed={features.includes(label)}
              onClick={() =>
                setFeatures((previous) =>
                  previous.includes(label)
                    ? previous.filter((name) => name !== label)
                    : [...previous, label],
                )
              }
            >
              {label}
              {observed ? <small>видим</small> : null}
            </button>
          ))}
        </div>
        <small className={styles.hint}>
          {features.length ? `Отмечено: ${features.length}` : 'не отмечали'}
        </small>
      </div>
    </div>
  )
}

const roles = ['ЛПР', 'ЛВР', 'Счета', 'Настр.', 'Партнёр'] as const
const maxPeople = 4
type Person = {
  id: number
  name: string
  phone: string
  url: string
  roles: (typeof roles)[number][]
}

function People({ client }: { client: DemoClient }) {
  const [people, setPeople] = useAccountDraft<Person[]>('people', () =>
    client.id === '91001002' ? [{ id: 0, name: 'Андрей', phone: '', url: '', roles: [] }] : [],
  )
  const nextId = useRef(1)
  const [binding, setBinding] = useState<number>()
  const missingRoles = roles
    .slice(0, -1)
    .filter((role) => !people.some((person) => person.roles.includes(role)))

  function readContactLink(form: HTMLFormElement) {
    const field = form.elements.namedItem('url')
    if (!(field instanceof HTMLInputElement)) return ''
    const url = field.value.trim()
    if (!url || /^https:\/\/rakurscrm\.amocrm\.ru\/contacts\/detail\/\d+\/?$/i.test(url)) return url
    field.setCustomValidity('Укажите ссылку на карточку контакта в rakurscrm.')
    field.reportValidity()
    return null
  }

  function addPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    const name = String(fields.get('name') ?? '').trim()
    const url = readContactLink(form)
    if (!name || url === null) return
    const person: Person = {
      id: nextId.current++,
      name,
      phone: String(fields.get('phone') ?? '').trim(),
      url,
      roles: [],
    }
    setPeople((previous) => [...previous, person])
    form.reset()
  }

  function bindPerson(event: FormEvent<HTMLFormElement>, id: number) {
    event.preventDefault()
    const url = readContactLink(event.currentTarget)
    if (!url) return
    setPeople((previous) =>
      previous.map((person) => (person.id === id ? { ...person, url } : person)),
    )
    setBinding(undefined)
  }

  function contactField(required = false) {
    return (
      <input
        type="url"
        name="url"
        aria-label="Ссылка на контакт в rakurscrm"
        placeholder={required ? 'ссылка на контакт в rakurscrm' : 'ссылка в rakurscrm, если есть'}
        required={required}
        onInput={(event) => event.currentTarget.setCustomValidity('')}
      />
    )
  }

  return (
    <section className={styles.people} aria-label="Люди">
      <header className={styles.peopleHead}>
        <h3 className={styles.label}>Люди</h3>
        <small className={styles.hint}>
          {people.length} из {maxPeople}
        </small>
        <small className={missingRoles.length ? styles.missingRoles : styles.completeRoles}>
          {missingRoles.length ? `без человека: ${missingRoles.join(', ')}` : 'все роли закрыты'}
        </small>
      </header>
      <div className={styles.peopleGrid}>
        {people.map((person) => (
          <article className={styles.person} key={person.id} aria-label={person.name}>
            <div className={styles.split}>
              <strong>{person.name}</strong>
              <button
                type="button"
                className={styles.remove}
                aria-label={`Убрать ${person.name} из портрета`}
                onClick={() =>
                  setPeople((previous) => previous.filter((item) => item.id !== person.id))
                }
              >
                ×
              </button>
            </div>
            <small>{person.phone || 'телефона нет'}</small>
            {person.url ? (
              <a className={styles.hint} href={person.url} target="_blank" rel="noreferrer">
                Контакт в rakurscrm ↗
              </a>
            ) : binding === person.id ? (
              <form className={styles.bindForm} onSubmit={(event) => bindPerson(event, person.id)}>
                {contactField(true)}
                <button type="submit">Связать</button>
              </form>
            ) : (
              <small className={styles.missingRoles}>
                нет в amoCRM ·{' '}
                <button type="button" className={styles.link} onClick={() => setBinding(person.id)}>
                  привязать
                </button>
              </small>
            )}
            <div className={styles.roles} role="group" aria-label={`Роли: ${person.name}`}>
              {roles.map((role) => (
                <button
                  type="button"
                  aria-pressed={person.roles.includes(role)}
                  key={role}
                  onClick={() =>
                    setPeople((previous) =>
                      previous.map((item) =>
                        item.id === person.id
                          ? {
                              ...item,
                              roles: item.roles.includes(role)
                                ? item.roles.filter((value) => value !== role)
                                : [...item.roles, role],
                            }
                          : item,
                      ),
                    )
                  }
                >
                  {role}
                </button>
              ))}
            </div>
          </article>
        ))}
        {people.length < maxPeople ? (
          <form className={styles.addPerson} onSubmit={addPerson}>
            <span className={styles.label}>+ Человек</span>
            <input name="name" placeholder="имя — обязательно" aria-label="Имя" required />
            <input name="phone" type="tel" placeholder="телефон, если есть" aria-label="Телефон" />
            {contactField()}
            <button type="submit">Добавить</button>
          </form>
        ) : null}
      </div>
    </section>
  )
}

function Deployment({
  rows,
  topCurrent,
  pro,
}: {
  rows: readonly DemoRow[]
  topCurrent: boolean
  pro: readonly string[]
}) {
  const installed = { FREE: new Set<string>(), TOP: new Set<string>(), PRO: new Set<string>() }
  for (const row of rows) {
    const widget = row.cells[1]
    if (typeof widget !== 'string' && widget.line) installed[widget.line].add(widget.text)
  }
  const free = installed.FREE.size
  const top = topCurrent ? installed.TOP.size : 0
  const scales = [
    {
      label: 'FREE — стоят',
      value: String(free),
      progress: free ? 100 : 0,
      hint: free ? 'хотя бы один должен стоять всегда' : 'ни одного — поставить, чтобы шли данные',
      line: 'free',
    },
    {
      label: 'TOP — работают',
      value: `${top} из 10 · ${top * 10}%`,
      progress: top * 10,
      hint: 'идёт тест или оплачен',
      line: 'top',
    },
    {
      label: 'PRO — работают',
      value: `${pro.length} из 4 · ${pro.length * 25}%`,
      progress: pro.length * 25,
      hint: pro.length ? `идёт тест или оплачен · ${pro.join(', ')}` : 'идёт тест или оплачен',
      line: 'pro',
    },
  ]
  return (
    <section className={styles.scales} aria-label="Использование виджетов">
      {scales.map((scale) => (
        <div className={styles.scale} key={scale.line}>
          <div className={styles.split}>
            <span>{scale.label}</span>
            <strong>{scale.value}</strong>
          </div>
          <progress
            aria-label={scale.label}
            data-line={scale.line}
            max={100}
            value={scale.progress}
          />
          <small className={styles.hint}>{scale.hint}</small>
        </div>
      ))}
    </section>
  )
}

const warmSteps = ['рассказали', 'стоит', 'показали', 'пользуется']
const answerOptions = ['да', 'нет', 'неизвестно'] as const

function Offer({
  topic,
  client,
  marked,
  toggle,
}: {
  topic: PortraitTopic
  client: DemoClient
  marked: readonly string[]
  toggle: (step: string) => void
}) {
  const steps =
    topic.id === 'license'
      ? ['рассказали', 'продлили через нас']
      : topic.partner
        ? warmSteps.filter((step) => step !== 'показали')
        : warmSteps
  const prices: Partial<Record<string, string | null>> = {
    calls: client.health === 'Получаем данные' ? '≈ 4 300 ₽/мес' : null,
    control: `${(6000 * Math.max(Number(client.seats), 5)).toLocaleString('ru-RU')} ₽/год`,
    duplicates: '25 000 ₽/год',
    telephony: '% нам',
    messengers: '40% нам',
  }
  const price = prices[topic.id]
  return (
    <div className={styles.offer}>
      <div className={styles.split}>
        {topic.leader === undefined ? (
          <span className={styles.hint}>{topic.hint}</span>
        ) : (
          <span>
            <b className={styles.leader}>Лидер</b>
            {topic.leader || '—'}
          </span>
        )}
        {price ? <span className={styles.hint}>{price}</span> : null}
      </div>
      {topic.leader !== undefined || topic.id === 'license' ? (
        <div className={styles.warmSteps} role="group" aria-label={`Теплота: ${topic.title}`}>
          {steps.map((step) => (
            <button
              type="button"
              key={step}
              aria-pressed={marked.includes(step)}
              onClick={() => toggle(step)}
            >
              {step}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

type TopicAnswer = { note?: string; answer?: string }

function TopicContext({ topic, client }: { topic: PortraitTopic; client: DemoClient }) {
  let context: ReactNode
  if (topic.id === 'calls') {
    context =
      client.health === 'Получаем данные' ? (
        <>
          ~1 000 мин/мес <b>аудит</b>
        </>
      ) : (
        'нет данных — вкладка «Аудит»'
      )
  }
  if (topic.id === 'control')
    context = (
      <>
        {client.seats} польз. <b>авто</b>
      </>
    )
  if (topic.id === 'license') context = `до ${formatDate(client.till)}`
  return context ? <span className={styles.context}>{context}</span> : null
}

export function Portrait({
  client,
  rows,
  topCurrent,
  topics,
  changeTopics,
  answered,
  setAnswered,
}: {
  client: DemoClient
  rows: readonly DemoRow[]
  topCurrent: boolean
  topics: readonly PortraitTopic[]
  changeTopics: (topics: readonly PortraitTopic[]) => void
  answered: number
  setAnswered: (count: number) => void
}) {
  const [marketSettings] = useAccountDraft<Record<string, MarketSetting>>('/marketSettings', {})
  const mappedWidgets = marketWidgets
    .filter((widget) => widget.accounts.includes(Number(client.id)))
    .map((widget) => ({ ...widget, settings: marketSettings[widget.code] ?? widget.settings }))
    .filter(({ settings }) => settings.inPortrait && settings.mark !== 'unknown')
  const [warmth, setWarmth] = useAccountDraft<Record<string, string[]>>('warmth', {})
  const pro = topics
    .filter((topic) => topic.pro && warmth[topic.id]?.includes('пользуется'))
    .map((topic) => topic.leader?.replace(/^наш /, '') || topic.title)
  const [answers, setAnswers] = useAccountDraft<Record<string, TopicAnswer>>('answers', {})

  function updateAnswer(id: string, change: TopicAnswer) {
    const next = { ...answers, [id]: { ...answers[id], ...change } }
    setAnswers(next)
    setAnswered(
      Object.values(next).filter(
        ({ note, answer }) => note?.trim() || (answer && answer !== 'неизвестно'),
      ).length,
    )
  }

  return (
    <Panel
      title="Портрет клиента"
      hint="что знаем о клиенте по темам · заметка сохраняется сама, когда уходите из поля"
      action={<PortraitTemplate topics={topics} changeTopics={changeTopics} />}
    >
      <Company client={client} />
      <People client={client} />
      <Deployment rows={rows} topCurrent={topCurrent} pro={pro} />
      <div className={styles.topicHead}>
        <span className={styles.label}>
          Тема · что у клиента сейчас ·{' '}
          <b>
            узнали {answered} из {topics.length}
          </b>
        </span>
        <span className={styles.label}>Вопрос и заметка</span>
        <span className={styles.label}>
          Лидер и теплота: рассказали → стоит → показали → пользуется
        </span>
      </div>
      {topics.map((topic, index) => {
        const { note, answer } = answers[topic.id] ?? {}
        const noted = Boolean(note?.trim())
        const answered = answer && answer !== 'неизвестно'
        const marked = warmth[topic.id] ?? []
        return (
          <section className={styles.topic} key={topic.id} aria-label={topic.title}>
            <span className={styles.priority} data-next={index === 0}>
              {index + 1}
            </span>
            <div className={styles.topicName}>
              <h3>{topic.title}</h3>
              {mappedWidgets
                .filter(({ settings }) => settings.category === topic.category)
                .map(({ code, name, settings }) => (
                  <p className={styles.noteState} key={code}>
                    {name} · {marketMarkLabels[settings.mark]}
                  </p>
                ))}
              <span className={styles.noteState} data-known={Boolean(noted || answered)}>
                {marked.includes('пользуется')
                  ? 'пользуется'
                  : noted
                    ? 'есть заметка'
                    : answered
                      ? `ответ: ${answer}`
                      : 'заметки нет'}
              </span>
              <TopicContext topic={topic} client={client} />
            </div>
            <div className={styles.question}>
              <div>
                {topic.question}
                {topic.yesNo ? (
                  <Choices
                    label={topic.question}
                    options={answerOptions}
                    onChange={(answer) => updateAnswer(topic.id, { answer })}
                  />
                ) : null}
              </div>
              <textarea
                aria-label={`Заметка: ${topic.title}`}
                rows={2}
                placeholder={topic.placeholder}
                onBlur={(event) => updateAnswer(topic.id, { note: event.target.value })}
              />
            </div>
            <Offer
              topic={topic}
              client={client}
              marked={marked}
              toggle={(step) =>
                setWarmth((previous) => ({
                  ...previous,
                  [topic.id]: marked.includes(step)
                    ? marked.filter((value) => value !== step)
                    : [...marked, step],
                }))
              }
            />
          </section>
        )
      })}
      {mappedWidgets.length ? (
        <section className={styles.marketWidgets} aria-label="Партнёрские виджеты у клиента">
          <h3>Партнёрские виджеты у клиента</h3>
          <ul>
            {mappedWidgets.map(({ code, name, settings, firstSeen }) => (
              <li key={code}>
                <strong>{name}</strong>
                <small>
                  {[settings.category, 'стоит с ' + formatDate(firstSeen)]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Panel>
  )
}
