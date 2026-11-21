import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { StatusBadge } from '../src/components/StatusBadge'
import {
  type AccountId,
  getPortrait,
  getTemplate,
  listNiches,
  type Portrait,
  type PortraitTemplate,
} from './accountsApi'
import { AccountForm } from './AccountForms'
import type { AccountActions } from './AccountOverview'
import { accountsKey, ReadFailure, useAccountAccessError } from './AccountsPage'
import { maturitySignals } from './portraitSignals'
import { PortraitPeople } from './PortraitPeople'
import { PortraitTemplateEditor } from './PortraitTemplateEditor'
import { PortraitWidgetTiers } from './PortraitWidgetTiers'
import styles from './AccountPortrait.module.css'

function lines(value: string) {
  return value
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean)
}

function triState(value: boolean | undefined) {
  return value === undefined ? 'Не указано' : value ? 'Да' : 'Нет'
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
  scope: string
  onExpired: () => void
  onForbidden: () => void
}

const workTypes = ['в офисе', 'в полях']
const customerTypes = ['B2B', 'B2C']
const ratings = ['1', '2', '3', '4', '5']

function ChoiceButtons({
  label,
  choices,
  selected,
  choose,
  clear,
}: {
  label: string
  choices: readonly string[]
  selected: readonly string[]
  choose: (value: string) => void
  clear: () => void
}) {
  return (
    <div className={styles.field}>
      <span>{label}</span>
      <div className={styles.choices} role="group" aria-label={label}>
        {choices.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={selected.includes(value)}
            onClick={() => choose(value)}
          >
            {value}
          </button>
        ))}
        <button type="button" aria-pressed={selected.length === 0} onClick={clear}>
          Не указано
        </button>
      </div>
    </div>
  )
}

function CompanyTypes({
  label,
  field,
  choices,
  values,
  editor,
}: {
  label: string
  field: 'work' | 'customers'
  choices: readonly string[]
  values: string[] | undefined
  editor?: PortraitEditor
}) {
  if (!editor) return <CompanyField label={label} value={values?.join(', ') || null} />
  const current = editor.fields[field]
  const selected = lines(current)
  const otherTypes = selected.filter((value) => !choices.includes(value))
  const combined = field === 'customers' && customerTypes.every((value) => selected.includes(value))
  return (
    <>
      <ChoiceButtons
        label={label}
        choices={field === 'customers' ? [...choices, 'B2B + B2C'] : choices}
        selected={combined ? [...selected, 'B2B + B2C'] : selected}
        choose={(value) => {
          const next =
            value === 'B2B + B2C'
              ? combined
                ? selected.filter((item) => !customerTypes.includes(item))
                : [...otherTypes, ...customerTypes]
              : selected.includes(value)
                ? selected.filter((item) => item !== value)
                : [...selected, value]
          editor.edit(field, next.join('\n'))
        }}
        clear={() => editor.edit(field, '')}
      />
      <details className={styles.customTypes}>
        <summary>
          {field === 'work' ? 'Другие форматы работы' : 'Другие типы клиентов'}
          {otherTypes.length > 0 ? <span> · {otherTypes.join(', ')}</span> : null}
        </summary>
        <label className={styles.field}>
          <span>По одному на строку</span>
          <textarea
            rows={2}
            value={current}
            onChange={(event) => editor.edit(field, event.target.value)}
          />
        </label>
      </details>
    </>
  )
}

function NichePicker({
  editor,
  catalog,
  loadNiches,
}: {
  editor: PortraitEditor
  catalog: Niche[]
  loadNiches?: () => void
}) {
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(false)
  const [chosen, setChosen] = useState<Niche>()
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(input.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [input])
  const results = useInfiniteQuery({
    queryKey: [...accountsKey, editor.scope, 'niches', search],
    queryFn: ({ pageParam, signal }) => listNiches(pageParam, signal, search),
    initialPageParam: '',
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: active && search !== '',
    retry: false,
  })
  useAccountAccessError(results.error, editor.onExpired, editor.onForbidden)
  const found = search ? (results.data?.pages.flatMap((page) => page.items) ?? []) : catalog
  const current = editor.fields.niche
  const selected = chosen?.id === current ? chosen : catalog.find((niche) => niche.id === current)
  const loadMore = search
    ? results.hasNextPage
      ? () => void results.fetchNextPage()
      : undefined
    : loadNiches

  function select(niche?: Niche) {
    setChosen(niche)
    setActive(false)
    setInput('')
    setSearch('')
    editor.edit('niche', niche?.id ?? '')
  }

  return (
    <div
      className={styles.niche}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setActive(false)
      }}
    >
      <label className={styles.field}>
        <span>Ниша</span>
        <input
          type="search"
          aria-label="Поиск по нишам"
          maxLength={200}
          placeholder={current ? 'Выбранная ниша' : 'Начните вводить название'}
          value={active ? input : (selected?.name ?? '')}
          onFocus={() => {
            setInput(selected?.name ?? '')
            setActive(true)
          }}
          onChange={(event) => {
            setInput(event.target.value)
            setActive(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setActive(false)
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              const term = input.trim()
              const exact = found.find(
                ({ name }) => name.toLocaleLowerCase('ru-RU') === term.toLocaleLowerCase('ru-RU'),
              )
              if (exact) select(exact)
              else {
                setSearch(term)
                setActive(true)
              }
            }
          }}
        />
      </label>
      {active ? (
        <div className={styles.nicheOptions} role="group" aria-label="Варианты ниши">
          {current ? (
            <button type="button" onClick={() => select()}>
              Убрать нишу
            </button>
          ) : null}
          {found.map((niche) => (
            <button type="button" key={niche.id} onClick={() => select(niche)}>
              {niche.name}
            </button>
          ))}
          {search && results.isPending ? (
            <p className={styles.meta} role="status">
              Ищем ниши…
            </p>
          ) : null}
          {search && results.isSuccess && found.length === 0 ? (
            <p className={styles.empty}>Ниши не найдены.</p>
          ) : null}
          {search && results.isError ? (
            <ReadFailure error={results.error} retry={() => void results.refetch()} />
          ) : null}
          {loadMore ? (
            <button type="button" disabled={results.isFetchingNextPage} onClick={loadMore}>
              Загрузить ещё ниши
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
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
  loadNiches,
}: Omit<PortraitRecordProps, 'template'> & {
  editor?: PortraitEditor
  loadNiches?: () => void
}) {
  const { company, maturity_signals: signals } = portrait
  const nicheName = niches.find((item) => item.id === company.niche_id)?.name
  const { fields, edit } = editor ?? {}
  return (
    <section className={styles.company}>
      <div className={styles.companyColumn}>
        <h3>О компании</h3>
        {editor ? (
          <NichePicker editor={editor} catalog={niches} loadNiches={loadNiches} />
        ) : (
          <CompanyField
            label="Ниша"
            value={nicheName ?? (company.niche_id ? 'Название недоступно' : null)}
          />
        )}
        <CompanyField label="Сайт" value={company.site}>
          {fields && edit ? (
            <input
              type="url"
              placeholder="Ссылка на сайт"
              value={fields.site}
              onChange={(event) => edit('site', event.target.value)}
            />
          ) : null}
        </CompanyField>
        {fields && edit ? (
          <ChoiceButtons
            label="Деньги"
            choices={fields.rating === '0' ? ['0', ...ratings] : ratings}
            selected={fields.rating ? [fields.rating] : []}
            choose={(value) => edit('rating', value)}
            clear={() => edit('rating', '')}
          />
        ) : (
          <CompanyField label="Деньги" value={company.rating} />
        )}
      </div>
      <div className={styles.companyColumn}>
        <CompanyTypes
          label="Менеджеры работают"
          field="work"
          choices={workTypes}
          values={company.work_types}
          editor={editor}
        />
        <CompanyTypes
          label="Клиенты компании"
          field="customers"
          choices={customerTypes}
          values={company.customer_types}
          editor={editor}
        />
      </div>
      <div className={styles.companyColumn}>
        <h3>amoCRM настроена · наш взгляд</h3>
        <ul className={styles.signals}>
          {maturitySignals.map(([id, label]) => {
            const signal = signals.find((item) => item.id === id)
            const mark = fields?.[id] ?? String(signal?.manual ?? '')
            const summary = (
              <>
                <span>{label}</span>
                {mark ? <small>{mark === 'true' ? 'да' : 'нет'}</small> : null}
              </>
            )
            return (
              <li key={id}>
                {edit ? (
                  <details className={styles.signal} name={portrait.account_id + '-maturity'}>
                    <summary
                      className={styles.signalChip}
                      data-mark={mark}
                      aria-label={
                        label + ' · ' + (mark ? (mark === 'true' ? 'Да' : 'Нет') : 'Не указано')
                      }
                    >
                      {summary}
                    </summary>
                    <div className={styles.signalOptions} role="group" aria-label={label}>
                      {[
                        ['true', 'Да'],
                        ['false', 'Нет'],
                        ['', 'Не указано'],
                      ].map(([value, text]) => (
                        <button
                          type="button"
                          key={value}
                          aria-pressed={mark === value}
                          onClick={(event) => {
                            const details = event.currentTarget.closest('details')
                            edit(id, value)
                            details?.removeAttribute('open')
                            details?.querySelector('summary')?.focus()
                          }}
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                  </details>
                ) : (
                  <span className={styles.signalChip} data-mark={mark}>
                    {summary}
                  </span>
                )}
                {signal?.observed !== undefined || signal?.source ? (
                  <p className={styles.observed}>
                    Наблюдение {triState(signal.observed)}
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
  fields,
  edit,
}: Pick<PortraitRecordProps, 'portrait' | 'template'> &
  Partial<Pick<PortraitEditor, 'fields' | 'edit'>>) {
  const configured = template?.topics ?? []
  const notes = new Map(portrait.topics.map((topic) => [topic.id, topic.note]))
  const unconfigured: PortraitTemplate['topics'] = portrait.topics
    .filter((topic) => !configured.some(({ id }) => id === topic.id))
    .map(({ id }) => ({ id, title: id, prompts: [] }))
  const topics = [...configured, ...unconfigured]

  return (
    <section className={styles.topics} aria-label="Темы портрета">
      {topics.length ? (
        <>
          <div className={styles.topicHead}>
            <div>
              <span>Тема · что у клиента сейчас</span>
              {configured.length > 0 ? (
                <strong className={styles.topicProgress}>
                  Заметки заполнены · {configured.filter(({ id }) => notes.get(id)?.trim()).length}{' '}
                  из {configured.length}
                </strong>
              ) : null}
            </div>
            <span>Вопрос и заметка</span>
            <span>Лидер и теплота</span>
          </div>
          {topics.map((topic, index) => {
            const name = 'topic:' + topic.id
            const note = notes.get(topic.id) ?? ''
            const editable = fields && edit && configured.some(({ id }) => id === topic.id)
            return (
              <div className={styles.topic} key={topic.id}>
                <div className={styles.topicTitle}>
                  <span className={styles.topicNumber} aria-hidden="true">
                    {index + 1}
                  </span>
                  <div>
                    <h3>{topic.title}</h3>
                    <span className={styles.topicPill}>
                      {note.trim() ? 'Есть заметка' : 'Заметки нет'}
                    </span>
                    {topic.market_categories?.length ? (
                      <ul className={styles.topicCategories} aria-label="Категории амоМаркета">
                        {topic.market_categories.map((category, categoryIndex) => (
                          <li className={styles.topicPill} key={categoryIndex}>
                            {category}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
                <div className={styles.topicContent}>
                  {topic.prompts.length ? (
                    <ul className={styles.prompts} aria-label="Вопросы">
                      {topic.prompts.map((prompt, promptIndex) => (
                        <li key={promptIndex}>{prompt}</li>
                      ))}
                    </ul>
                  ) : null}
                  {editable ? (
                    <textarea
                      aria-label={'Заметка: ' + topic.title}
                      rows={2}
                      placeholder={
                        topic.answer_mode === 'yes_no' ? 'Ответ и комментарий' : 'Заметка'
                      }
                      value={fields[name] ?? note}
                      onChange={(event) => edit(name, event.target.value)}
                    />
                  ) : (
                    <p className={styles.note}>{note.trim() ? note : 'Заметки пока нет.'}</p>
                  )}
                </div>
                <div className={styles.topicAdvice}>
                  {topic.leader ? (
                    <p>
                      <strong className={styles.topicLeader}>Лидер</strong> {topic.leader}
                    </p>
                  ) : null}
                  {topic.warmth_steps?.length ? (
                    <ul className={styles.warmthSteps} aria-label="Этапы теплоты">
                      {topic.warmth_steps.map((step, stepIndex) => (
                        <li key={stepIndex}>{step}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
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
  niches,
  loadNiches,
  scope,
  ...actions
}: AccountActions &
  Omit<PortraitRecordProps, 'template'> & {
    scope: string
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
  }
  return (
    <div className={styles.portraitForm}>
      <AccountForm
        {...actions}
        inline
        actionsOnEdit
        id={account + ':portrait'}
        title="Паспорт клиента"
        version={portrait.version}
        initial={initial}
        current={
          <details className={styles.currentPortrait}>
            <summary>Посмотреть текущий портрет</summary>
            <CompanyProfile portrait={portrait} niches={niches} />
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
              .map(([id]) => ({ id, manual: fields[id] === '' ? null : fields[id] === 'true' })),
            topics: [],
          }),
        })}
      >
        {(fields, edit) => (
          <CompanyProfile
            portrait={portrait}
            niches={niches}
            editor={{
              fields,
              edit,
              scope,
              onExpired: actions.onExpired,
              onForbidden: actions.onForbidden,
            }}
            loadNiches={loadNiches}
          />
        )}
      </AccountForm>
    </div>
  )
}

function PortraitTopicFields({
  portrait,
  template,
  ...actions
}: AccountActions & { portrait: Portrait; template: PortraitTemplate }) {
  const account = portrait.account_id
  const initial = Object.fromEntries(
    template.topics.map((topic) => [
      'topic:' + topic.id,
      portrait.topics.find((item) => item.id === topic.id)?.note ?? '',
    ]),
  )
  return (
    <div className={styles.portraitForm}>
      <AccountForm
        {...actions}
        inline
        actionsOnEdit
        id={account + ':portrait-notes'}
        title="Заметки портрета"
        submitLabel="Сохранить заметки"
        version={portrait.version}
        initial={initial}
        current={<PortraitTopics portrait={portrait} template={template} />}
        command={(fields, original, version, key) => ({
          kind: 'portrait',
          account,
          version,
          key,
          body: JSON.stringify({
            topics: template.topics.flatMap(({ id }) => {
              const field = 'topic:' + id
              return fields[field] === original[field] ? [] : [{ id, note: fields[field] }]
            }),
          }),
        })}
      >
        {(fields, edit) => (
          <PortraitTopics portrait={portrait} template={template} fields={fields} edit={edit} />
        )}
      </AccountForm>
    </div>
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
              {canWrite ? 'Заметки сохраняются кнопкой «Сохранить заметки»' : null}
              {globalTemplate && current.template_version !== globalTemplate.version ? (
                <StatusBadge domain="freshness" state="stale" calm />
              ) : null}
            </p>
          ) : null}
        </div>
        {current && globalTemplate ? (
          <PortraitTemplateEditor
            {...actions}
            template={globalTemplate}
            canConfigure={canConfigure}
          />
        ) : null}
      </header>
      <div className={styles.portraitBody}>
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
            {canWrite && niches.data && !niches.isError ? (
              <PortraitFields
                {...actions}
                portrait={current}
                scope={scope}
                niches={allNiches}
                loadNiches={niches.hasNextPage ? () => void niches.fetchNextPage() : undefined}
              />
            ) : (
              <CompanyProfile portrait={current} niches={allNiches} />
            )}
            <PortraitPeople portrait={current} canWrite={canWrite} {...actions} />
            <PortraitWidgetTiers tiers={current.widget_tiers} />
            {canWrite && globalTemplate ? (
              <PortraitTopicFields portrait={current} template={globalTemplate} {...actions} />
            ) : globalTemplate || template.isError || current.topics.length > 0 ? (
              <PortraitTopics portrait={current} template={globalTemplate} />
            ) : null}
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
