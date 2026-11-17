import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createRequestKey } from '../src/features/operations/intents'
import { StatusBadge } from '../src/components/StatusBadge'
import {
  type AccountId,
  getPortrait,
  getTemplate,
  listNiches,
  parseTemplate,
  type Portrait,
  type PortraitTemplate,
} from './accountsApi'
import { AccountForm } from './AccountForms'
import type { AccountActions } from './AccountOverview'
import { accountsKey, ReadFailure, useAccountAccessError } from './AccountsPage'
import styles from './Accounts.module.css'

const maturitySignals = [
  ['09ccc1b9-741c-50a5-91b1-05a3e1ac8beb', 'Воронка под их продажи'],
  ['240477de-a0d7-52b5-b499-b585787c677b', 'Заявки подтягиваются'],
  ['3613548f-a233-5652-a6c8-223307ed4f19', 'Мессенджеры'],
  ['5e1a0f72-3a2f-50fb-a8e9-ce3591bd29a5', 'Телефония'],
  ['af221b8d-7b2d-5f59-827e-cd9c7e8eda49', 'Работают с задачами'],
  ['4b63617c-2fe3-580f-8cb4-ce57cece2601', 'Нет сделок без задач'],
  ['76f07ac7-48ac-5e3e-af3d-adb38f2846f2', 'Salesbot и автоматизации'],
  ['403a78b9-251f-5972-9c84-e044f4b6c679', 'Отчёты руководителю'],
  ['d75f3d1a-bd74-5093-a973-75b25e45b7ac', 'Контроль качества'],
  ['f9676d8d-c705-56c9-a855-ea7eebadcbf2', 'Контроль дублей'],
  ['b8162015-de41-5b2b-a371-98f822be4cca', 'Регламенты и обучение'],
  ['559af0b6-9ec4-5f81-8c08-b2e9751837b6', 'Счета из amoCRM'],
  ['00a1eca7-7727-5317-86f7-21b73ca5f3b6', 'Эквайринг'],
] as const

function lines(value: string) {
  return value
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean)
}

function triState(value: boolean | undefined) {
  return value === undefined ? 'Не указано' : value ? 'Да' : 'Нет'
}

function TemplateEditor({ template, ...actions }: AccountActions & { template: PortraitTemplate }) {
  return (
    <details className={styles.panel}>
      <summary>Настроить шаблон тем</summary>
      <AccountForm
        id="portrait-template"
        {...actions}
        title="Шаблон тем"
        version={template.version}
        initial={{ topics: JSON.stringify(template.topics) }}
        current={
          <p>Текущие темы: {template.topics.map((topic) => topic.title).join(', ') || 'нет тем'}</p>
        }
        command={(fields, _, version, key) => ({
          kind: 'template',
          version,
          key,
          body: '{"topics":' + fields.topics + '}',
        })}
      >
        {(fields, edit) => {
          const { topics } = parseTemplate({
            version: template.version,
            topics: JSON.parse(fields.topics),
          })
          const set = (next: PortraitTemplate['topics']) => edit('topics', JSON.stringify(next))
          return (
            <>
              {topics.map((topic, index) => (
                <fieldset key={topic.id}>
                  <legend>Тема {index + 1}</legend>
                  <label>
                    Название темы
                    <input
                      required
                      maxLength={256}
                      value={topic.title}
                      onChange={(event) =>
                        set(
                          topics.map((item) =>
                            item.id === topic.id ? { ...item, title: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Подсказки, по одной на строку
                    <textarea
                      defaultValue={topic.prompts.join('\n')}
                      onChange={(event) =>
                        set(
                          topics.map((item) =>
                            item.id === topic.id
                              ? { ...item, prompts: lines(event.target.value) }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => {
                        const previous = topics[index - 1]
                        if (previous)
                          set([
                            ...topics.slice(0, index - 1),
                            topic,
                            previous,
                            ...topics.slice(index + 1),
                          ])
                      }}
                    >
                      Выше
                    </button>
                    <button
                      type="button"
                      onClick={() => set(topics.filter((item) => item.id !== topic.id))}
                    >
                      Удалить тему
                    </button>
                  </div>
                </fieldset>
              ))}
              <button
                type="button"
                onClick={() => set([...topics, { id: createRequestKey(), title: '', prompts: [] }])}
              >
                Добавить тему
              </button>
            </>
          )
        }}
      </AccountForm>
    </details>
  )
}

type Niche = Awaited<ReturnType<typeof listNiches>>['items'][number]

function PortraitFields({
  portrait,
  template,
  niches,
  loadNiches,
  ...actions
}: AccountActions & {
  portrait: Portrait
  template: PortraitTemplate
  niches: Niche[]
  loadNiches?: () => void
}) {
  const account = portrait.account_id
  const initial: Record<string, string> = {
    niche: portrait.company.niche_id ?? '',
    site: portrait.company.site ?? '',
    rating: portrait.company.rating?.toString() ?? '',
    work: portrait.company.work_types?.join('\n') ?? '',
    customers: portrait.company.customer_types?.join('\n') ?? '',
    ...Object.fromEntries(
      maturitySignals.map(([id]) => [
        id,
        String(portrait.maturity_signals.find((signal) => signal.id === id)?.manual ?? ''),
      ]),
    ),
    ...Object.fromEntries(
      template.topics.map((topic) => [
        'topic:' + topic.id,
        portrait.topics.find((item) => item.id === topic.id)?.note ?? '',
      ]),
    ),
  }
  return (
    <AccountForm
      {...actions}
      id={account + ':portrait'}
      title="Редактирование портрета"
      version={portrait.version}
      initial={initial}
      current={
        <p>
          Текущий рейтинг: {portrait.company.rating ?? '—'}. Сайт: {portrait.company.site ?? '—'}.
        </p>
      }
      command={(fields, original, version, key) => ({
        kind: 'portrait',
        account,
        version,
        key,
        body: JSON.stringify({
          company: {
            niche_id: fields.niche === original.niche ? undefined : fields.niche || null,
            site: fields.site === original.site ? undefined : fields.site.trim() || null,
            rating:
              fields.rating === original.rating
                ? undefined
                : fields.rating === ''
                  ? null
                  : Number(fields.rating),
            work_types: fields.work === original.work ? undefined : lines(fields.work),
            customer_types:
              fields.customers === original.customers ? undefined : lines(fields.customers),
          },
          maturity_signals: maturitySignals
            .filter(([id]) => fields[id] !== original[id])
            .map(([id]) => ({
              id,
              manual: fields[id] === '' ? null : fields[id] === 'true',
            })),
          topics: template.topics
            .filter(
              (topic) =>
                fields['topic:' + topic.id] !== undefined &&
                fields['topic:' + topic.id] !== original['topic:' + topic.id],
            )
            .map((topic) => ({
              id: topic.id,
              note: fields['topic:' + topic.id],
            })),
        }),
      })}
    >
      {(fields, edit) => (
        <>
          <div>
            <label>
              Ниша
              <select value={fields.niche} onChange={(event) => edit('niche', event.target.value)}>
                <option value="">Не указана</option>
                {fields.niche && !niches.some((niche) => niche.id === fields.niche) ? (
                  <option value={fields.niche}>Выбранная ниша</option>
                ) : null}
                {niches.map((niche) => (
                  <option value={niche.id} key={niche.id}>
                    {niche.name}
                  </option>
                ))}
              </select>
            </label>
            {loadNiches ? (
              <button type="button" onClick={loadNiches}>
                Загрузить ещё ниши
              </button>
            ) : null}
          </div>
          <label>
            Сайт
            <input
              type="url"
              value={fields.site}
              onChange={(event) => edit('site', event.target.value)}
            />
          </label>
          <label>
            Рейтинг
            <input
              type="number"
              min="0"
              max="5"
              value={fields.rating}
              onChange={(event) => edit('rating', event.target.value)}
            />
          </label>
          <label>
            Типы работы, по одному на строку
            <textarea value={fields.work} onChange={(event) => edit('work', event.target.value)} />
          </label>
          <label>
            Типы клиентов, по одному на строку
            <textarea
              value={fields.customers}
              onChange={(event) => edit('customers', event.target.value)}
            />
          </label>
          {maturitySignals.map(([id, label]) => (
            <label key={id}>
              {label}
              <select value={fields[id]} onChange={(event) => edit(id, event.target.value)}>
                <option value="">Не указано</option>
                <option value="true">Да</option>
                <option value="false">Нет</option>
              </select>
            </label>
          ))}
          {template.topics.map((topic) => (
            <label key={topic.id}>
              {topic.title}
              {topic.prompts.length ? <small>{topic.prompts.join(' · ')}</small> : null}
              <textarea
                value={fields['topic:' + topic.id] ?? initial['topic:' + topic.id]}
                onChange={(event) => edit('topic:' + topic.id, event.target.value)}
              />
            </label>
          ))}
        </>
      )}
    </AccountForm>
  )
}

export function AccountPortrait({
  account,
  scope,
  canWrite,
  canConfigure,
  ...actions
}: AccountActions & {
  account: AccountId
  scope: string
  canWrite: boolean
  canConfigure: boolean
}) {
  const portrait = useQuery({
    queryKey: [...accountsKey, scope, account, 'portrait'],
    queryFn: ({ signal }) => getPortrait(account, signal),
    retry: false,
  })
  const template = useQuery({
    queryKey: [...accountsKey, scope, 'template'],
    queryFn: ({ signal }) => getTemplate(signal),
    retry: false,
  })
  const niches = useInfiniteQuery({
    queryKey: [...accountsKey, scope, 'niches'],
    queryFn: ({ pageParam, signal }) => listNiches(pageParam, signal),
    initialPageParam: '',
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    retry: false,
  })
  const error = portrait.error ?? template.error ?? niches.error
  useAccountAccessError(error, actions.onExpired, actions.onForbidden)
  if (portrait.isError)
    return <ReadFailure error={portrait.error} retry={() => void portrait.refetch()} />
  if (!portrait.data) return <p role="status">Загружаем портрет…</p>
  const current = portrait.data
  const globalTemplate = template.isError ? undefined : template.data
  const allNiches = niches.isError ? [] : (niches.data?.pages.flatMap((page) => page.items) ?? [])
  const niche = allNiches.find((item) => item.id === current.company.niche_id)
  return (
    <div className={styles.workspace}>
      {template.isError ? (
        <ReadFailure error={template.error} retry={() => void template.refetch()} />
      ) : null}
      {niches.isError ? (
        <ReadFailure error={niches.error} retry={() => void niches.refetch()} />
      ) : null}
      {template.isPending || niches.isPending ? (
        <p role="status">Загружаем шаблон и ниши…</p>
      ) : null}
      <dl className={styles.facts}>
        <dt>Ниша</dt>
        <dd>{niche?.name ?? current.company.niche_id ?? '—'}</dd>
        <dt>Сайт</dt>
        <dd>{current.company.site ?? '—'}</dd>
        <dt>Рейтинг</dt>
        <dd>{current.company.rating ?? '—'}</dd>
        <dt>Типы работы</dt>
        <dd>{current.company.work_types?.join(', ') || '—'}</dd>
        <dt>Типы клиентов</dt>
        <dd>{current.company.customer_types?.join(', ') || '—'}</dd>
        <dt>Версия портрета</dt>
        <dd>{current.version}</dd>
        <dt>Версия шаблона</dt>
        <dd>{current.template_version}</dd>
      </dl>
      {current.maturity_signals.length > 0 ? (
        <section>
          <h3>Сохранённые отметки</h3>
          <dl className={styles.facts}>
            {maturitySignals.map(([id, label]) => {
              const signal = current.maturity_signals.find((item) => item.id === id)
              return signal ? (
                <div key={id}>
                  <dt>{label}</dt>
                  <dd>
                    Ручная отметка: {triState(signal.manual)} · наблюдение:{' '}
                    {triState(signal.observed)}
                    {signal.source ? <> · {signal.source}</> : null}
                  </dd>
                </div>
              ) : null
            })}
          </dl>
        </section>
      ) : null}
      {current.topics.length ? (
        <section>
          <h3>Сохранённые заметки по темам</h3>
          <ul>
            {current.topics.map((topic) => (
              <li key={topic.id}>
                {globalTemplate?.topics.find((item) => item.id === topic.id)?.title ?? topic.id}:{' '}
                {topic.note}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {canWrite && globalTemplate && niches.data && !niches.isError ? (
        <PortraitFields
          {...actions}
          portrait={current}
          template={globalTemplate}
          niches={allNiches}
          loadNiches={niches.hasNextPage ? () => void niches.fetchNextPage() : undefined}
        />
      ) : null}
      <section>
        <h3>Даты аудита</h3>
        {current.audit_dates.length ? (
          <ul>
            {current.audit_dates.map((audit) => (
              <li key={audit.id}>
                <time dateTime={audit.date}>{audit.date}</time>
                {audit.note ? ' · ' + audit.note : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>Дат аудита пока нет</p>
        )}
      </section>
      {canWrite ? (
        <AccountForm
          {...actions}
          id={account + ':audit'}
          title="Добавить дату аудита"
          version={current.version}
          initial={{ date: '', note: '' }}
          submitLabel="Добавить дату"
          command={(fields, _, version, key) => ({
            kind: 'audit',
            account,
            version,
            key,
            body: JSON.stringify({ date: fields.date, note: fields.note || null }),
          })}
        >
          {(fields, edit) => (
            <>
              <label>
                Дата
                <input
                  type="date"
                  required
                  value={fields.date}
                  onChange={(event) => edit('date', event.target.value)}
                />
              </label>
              <label>
                Заметка аудита
                <textarea
                  value={fields.note}
                  onChange={(event) => edit('note', event.target.value)}
                />
              </label>
            </>
          )}
        </AccountForm>
      ) : null}
      {canConfigure && globalTemplate ? (
        <TemplateEditor {...actions} template={globalTemplate} />
      ) : null}
      {globalTemplate && current.template_version !== globalTemplate.version ? (
        <StatusBadge domain="freshness" state="stale" calm />
      ) : null}
    </div>
  )
}
