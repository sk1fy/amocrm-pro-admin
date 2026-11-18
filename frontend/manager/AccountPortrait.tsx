import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
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
import accountStyles from './Accounts.module.css'
import styles from './AccountPortrait.module.css'

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
    <details className={styles.template}>
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
                  <div className={accountStyles.actions}>
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

type PortraitRecordProps = {
  portrait: Portrait
  template?: PortraitTemplate
  niches: Niche[]
}

type PortraitEditor = {
  fields: Record<string, string>
  edit: (name: string, value: string) => void
  loadNiches?: () => void
}

function CompanyField({
  label,
  value,
  children,
}: {
  label: string
  value: string | number | null | undefined
  children?: ReactNode
}) {
  return children ? (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  ) : (
    <div className={styles.field}>
      <span>{label}</span>
      <p className={styles.fieldValue}>{value ?? '—'}</p>
    </div>
  )
}

function CompanyProfile({
  portrait,
  niches,
  editor,
}: Omit<PortraitRecordProps, 'template'> & { editor?: PortraitEditor }) {
  const { company, maturity_signals: signals } = portrait
  const nicheName = niches.find((item) => item.id === company.niche_id)?.name ?? company.niche_id
  const { fields, edit, loadNiches } = editor ?? {}
  return (
    <section className={styles.company}>
      <div className={styles.companyColumn}>
        <h3>О компании</h3>
        <CompanyField label="Ниша" value={nicheName}>
          {fields && edit ? (
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
          ) : null}
        </CompanyField>
        {loadNiches ? (
          <button type="button" className={styles.more} onClick={loadNiches}>
            Загрузить ещё ниши
          </button>
        ) : null}
        <CompanyField label="Сайт" value={company.site}>
          {fields && edit ? (
            <input
              type="url"
              value={fields.site}
              onChange={(event) => edit('site', event.target.value)}
            />
          ) : null}
        </CompanyField>
        <CompanyField label="Рейтинг" value={company.rating}>
          {fields && edit ? (
            <input
              type="number"
              min="0"
              max="5"
              value={fields.rating}
              onChange={(event) => edit('rating', event.target.value)}
            />
          ) : null}
        </CompanyField>
      </div>
      <div className={styles.companyColumn}>
        <h3>Работа и клиенты</h3>
        <CompanyField
          label={editor ? 'Типы работы, по одному на строку' : 'Типы работы'}
          value={company.work_types?.length ? company.work_types.join(', ') : null}
        >
          {fields && edit ? (
            <textarea
              rows={2}
              value={fields.work}
              onChange={(event) => edit('work', event.target.value)}
            />
          ) : null}
        </CompanyField>
        <CompanyField
          label={editor ? 'Типы клиентов, по одному на строку' : 'Типы клиентов'}
          value={company.customer_types?.length ? company.customer_types.join(', ') : null}
        >
          {fields && edit ? (
            <textarea
              rows={2}
              value={fields.customers}
              onChange={(event) => edit('customers', event.target.value)}
            />
          ) : null}
        </CompanyField>
      </div>
      <div className={styles.companyColumn}>
        <h3>Ручные отметки amoCRM</h3>
        <ul className={styles.signals}>
          {maturitySignals.map(([id, label]) => {
            const signal = signals.find((item) => item.id === id)
            return (
              <li key={id}>
                {fields && edit ? (
                  <label className={styles.signalChoice}>
                    <span>{label}</span>
                    <select value={fields[id]} onChange={(event) => edit(id, event.target.value)}>
                      <option value="">—</option>
                      <option value="true">Да</option>
                      <option value="false">Нет</option>
                    </select>
                  </label>
                ) : (
                  <div className={styles.signalChoice}>
                    <span>{label}</span>
                    <span className={styles.signalValue}>{triState(signal?.manual)}</span>
                  </div>
                )}
                {signal?.observed !== undefined || signal?.source ? (
                  <p className={styles.observed}>
                    Наблюдение: {triState(signal.observed)}
                    {signal.source ? <> · {signal.source}</> : null}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

function PortraitTopics({
  portrait,
  template,
  editor,
}: Pick<PortraitRecordProps, 'portrait' | 'template'> & { editor?: PortraitEditor }) {
  const configured = template?.topics ?? []
  const notes = new Map(portrait.topics.map((topic) => [topic.id, topic.note]))
  const unconfigured = portrait.topics
    .filter((topic) => !configured.some(({ id }) => id === topic.id))
    .map(({ id }) => ({ id, title: id, prompts: [] }))
  const topics = [...configured, ...unconfigured]

  return (
    <section className={styles.topics}>
      <h3>Темы портрета</h3>
      {topics.length ? (
        <>
          <div className={styles.topicHead} aria-hidden="true">
            <span>Тема</span>
            <span>Вопросы</span>
            <span>Заметка</span>
          </div>
          {topics.map((topic) => {
            const name = 'topic:' + topic.id
            const note = notes.get(topic.id) ?? ''
            const editable = editor && configured.some(({ id }) => id === topic.id)
            return (
              <div className={styles.topic} key={topic.id}>
                <h4>{topic.title}</h4>
                {topic.prompts.length ? (
                  <ul className={styles.prompts}>
                    {topic.prompts.map((prompt, index) => (
                      <li key={index}>{prompt}</li>
                    ))}
                  </ul>
                ) : (
                  <span className={styles.noPrompt}>—</span>
                )}
                {editable ? (
                  <textarea
                    aria-label={`Заметка: ${topic.title}`}
                    rows={2}
                    placeholder="Добавить заметку"
                    value={editor.fields[name] ?? note}
                    onChange={(event) => editor.edit(name, event.target.value)}
                  />
                ) : (
                  <p className={styles.note}>{note.trim() ? note : '—'}</p>
                )}
              </div>
            )
          })}
        </>
      ) : (
        <p className={styles.empty}>{template ? 'Тем пока нет' : 'Темы пока недоступны'}</p>
      )}
    </section>
  )
}

function PortraitFields({
  portrait,
  template,
  niches,
  loadNiches,
  ...actions
}: AccountActions & PortraitRecordProps & { template: PortraitTemplate; loadNiches?: () => void }) {
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
      inline
      id={account + ':portrait'}
      title="Редактирование портрета"
      version={portrait.version}
      initial={initial}
      current={
        <details className={styles.currentPortrait}>
          <summary>Посмотреть текущий портрет</summary>
          <CompanyProfile portrait={portrait} niches={niches} />
          <PortraitTopics portrait={portrait} template={template} />
        </details>
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
          <CompanyProfile
            portrait={portrait}
            niches={niches}
            editor={{ fields, edit, loadNiches }}
          />
          <PortraitTopics portrait={portrait} template={template} editor={{ fields, edit }} />
        </>
      )}
    </AccountForm>
  )
}

type PortraitTabProps = AccountActions & {
  account: AccountId
  scope: string
  canWrite: boolean
}

function usePortrait(account: AccountId, scope: string) {
  return useQuery({
    queryKey: [...accountsKey, scope, account, 'portrait'],
    queryFn: ({ signal }) => getPortrait(account, signal),
    retry: false,
  })
}

export function AccountPortrait({
  account,
  scope,
  canWrite,
  canConfigure,
  ...actions
}: PortraitTabProps & { canConfigure: boolean }) {
  const portrait = usePortrait(account, scope)
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
  const current = portrait.isError ? undefined : portrait.data
  const globalTemplate = template.isError ? undefined : template.data
  const allNiches = niches.isError ? [] : (niches.data?.pages.flatMap((page) => page.items) ?? [])
  return (
    <section className={styles.panel} aria-label="Портрет клиента">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h2>Портрет клиента</h2>
          {current ? (
            <p className={styles.meta}>
              Версия портрета {current.version} · Версия шаблона {current.template_version}
              {globalTemplate && current.template_version !== globalTemplate.version ? (
                <StatusBadge domain="freshness" state="stale" calm />
              ) : null}
            </p>
          ) : null}
        </div>
        {current && canConfigure && globalTemplate ? (
          <TemplateEditor {...actions} template={globalTemplate} />
        ) : null}
      </header>
      <div className={styles.body}>
        {portrait.isError ? (
          <ReadFailure error={portrait.error} retry={() => void portrait.refetch()} />
        ) : current ? (
          <>
            {template.isError ? (
              <ReadFailure error={template.error} retry={() => void template.refetch()} />
            ) : null}
            {niches.isError ? (
              <ReadFailure error={niches.error} retry={() => void niches.refetch()} />
            ) : null}
            {template.isPending || niches.isPending ? (
              <p className={styles.meta} role="status">
                Загружаем шаблон и ниши…
              </p>
            ) : null}
            {canWrite && globalTemplate && niches.data && !niches.isError ? (
              <PortraitFields
                {...actions}
                portrait={current}
                template={globalTemplate}
                niches={allNiches}
                loadNiches={niches.hasNextPage ? () => void niches.fetchNextPage() : undefined}
              />
            ) : (
              <>
                <CompanyProfile portrait={current} niches={allNiches} />
                {globalTemplate || template.isError || current.topics.length > 0 ? (
                  <PortraitTopics portrait={current} template={globalTemplate} />
                ) : null}
              </>
            )}
          </>
        ) : (
          <p className={styles.meta} role="status">
            Загружаем портрет…
          </p>
        )}
      </div>
    </section>
  )
}

export function AccountAudit({ account, scope, canWrite, ...actions }: PortraitTabProps) {
  const portrait = usePortrait(account, scope)
  useAccountAccessError(portrait.error, actions.onExpired, actions.onForbidden)
  const current = portrait.isError ? undefined : portrait.data

  return (
    <section className={styles.panel} aria-label="Аудит клиента">
      <header className={styles.header}>
        <h2>Аудит клиента</h2>
      </header>
      <div className={styles.body}>
        {portrait.isError ? (
          <ReadFailure error={portrait.error} retry={() => void portrait.refetch()} />
        ) : current ? (
          <div className={styles.auditLayout} data-editor={canWrite}>
            <section className={styles.auditHistory}>
              <h3>Даты аудита</h3>
              {current.audit_dates.length ? (
                <ul className={styles.auditDates}>
                  {current.audit_dates.map((audit) => (
                    <li key={audit.id}>
                      <time dateTime={audit.date}>{audit.date}</time>
                      <span className={styles.note}>{audit.note ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>Дат аудита пока нет</p>
              )}
            </section>
            {canWrite ? (
              <div className={styles.auditEditor}>
                <h3>Добавить дату аудита</h3>
                <AccountForm
                  {...actions}
                  inline
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
                      <label className={styles.field}>
                        Дата
                        <input
                          type="date"
                          required
                          value={fields.date}
                          onChange={(event) => edit('date', event.target.value)}
                        />
                      </label>
                      <label className={styles.field}>
                        Заметка аудита
                        <textarea
                          rows={3}
                          value={fields.note}
                          onChange={(event) => edit('note', event.target.value)}
                        />
                      </label>
                    </>
                  )}
                </AccountForm>
              </div>
            ) : null}
          </div>
        ) : (
          <p className={styles.meta} role="status">
            Загружаем даты аудита…
          </p>
        )}
      </div>
    </section>
  )
}
