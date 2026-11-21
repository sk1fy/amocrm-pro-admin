import { useRef } from 'react'
import { createRequestKey } from '../src/features/operations/intents'
import { parseTemplate, type PortraitTemplate } from './accountsApi'
import { AccountForm } from './AccountForms'
import type { AccountActions } from './AccountOverview'
import styles from './AccountPortrait.module.css'

function cleanLines(values: string[] | undefined) {
  return values?.map((value) => value.trim()).filter(Boolean) ?? []
}

function TemplateColumns() {
  return (
    <div className={styles.templateColumns} aria-hidden="true">
      <span>Место</span>
      <span>Тема и вопрос</span>
      <span>Лидер · что предлагаем</span>
      <span>Категории амоМаркета</span>
    </div>
  )
}

function TemplatePreview({ topics }: Pick<PortraitTemplate, 'topics'>) {
  if (topics.length === 0) return <p className={styles.empty}>Тем пока нет.</p>
  return (
    <div className={styles.templateTable}>
      <TemplateColumns />
      {topics.map((topic, index) => (
        <div className={styles.templateRow} key={topic.id}>
          <span>{index + 1}</span>
          <div className={styles.templateFields}>
            <strong>{topic.title}</strong>
            {topic.prompts.map((prompt, i) => (
              <span key={i}>{prompt}</span>
            ))}
            <small>
              {topic.answer_mode === 'yes_no'
                ? 'Да / нет / неизвестно и заметка'
                : 'Только заметка'}
            </small>
          </div>
          <div className={styles.templateFields}>
            <span>{topic.leader || '—'}</span>
            {topic.warmth_steps?.length ? <small>{topic.warmth_steps.join(' → ')}</small> : null}
          </div>
          <span>{topic.market_categories?.join(', ') || '—'}</span>
        </div>
      ))}
    </div>
  )
}

export function PortraitTemplateEditor({
  template,
  canConfigure,
  ...actions
}: AccountActions & { template: PortraitTemplate; canConfigure: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = () => dialog.current?.close()
  return (
    <>
      <button
        type="button"
        className={styles.templateButton}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        Шаблон тем
      </button>
      <dialog
        ref={dialog}
        className={styles.templateDialog}
        aria-labelledby="portrait-template-heading"
      >
        <header className={styles.templateHeading}>
          <div>
            <h2 id="portrait-template-heading">Шаблон тем портрета</h2>
            <p>Общий шаблон для всех клиентов</p>
          </div>
          <button type="button" onClick={close} aria-label="Закрыть шаблон тем">
            ×
          </button>
        </header>
        <div className={styles.templateBody}>
          {canConfigure ? (
            <AccountForm
              id="portrait-template"
              {...actions}
              inline
              title="Темы шаблона"
              version={template.version}
              initial={{ topics: JSON.stringify(template.topics) }}
              onCancel={close}
              onSaved={() => {
                actions.onSaved()
                close()
              }}
              submitLabel="Сохранить шаблон"
              current={
                <p>
                  Текущие темы ·{' '}
                  {template.topics.map((topic) => topic.title).join(', ') || 'нет тем'}
                </p>
              }
              command={(fields, _, version, key) => ({
                kind: 'template',
                version,
                key,
                body: JSON.stringify({
                  topics: parseTemplate({ version, topics: JSON.parse(fields.topics) }).topics.map(
                    (topic) => ({
                      ...topic,
                      title: topic.title.trim(),
                      prompts: cleanLines(topic.prompts),
                      leader: topic.leader?.trim() || undefined,
                      market_categories: cleanLines(topic.market_categories),
                      warmth_steps: cleanLines(topic.warmth_steps),
                    }),
                  ),
                }),
              })}
            >
              {(fields, edit) => {
                const { topics } = parseTemplate({
                  version: template.version,
                  topics: JSON.parse(fields.topics),
                })
                const set = (next: PortraitTemplate['topics']) =>
                  edit('topics', JSON.stringify(next))
                return (
                  <div className={styles.templateEditRows}>
                    {topics.length ? (
                      <div className={styles.templateTable}>
                        <TemplateColumns />
                        {topics.map((topic, index) => {
                          function update(patch: Partial<typeof topic>) {
                            set(
                              topics.map((item) =>
                                item.id === topic.id ? { ...item, ...patch } : item,
                              ),
                            )
                          }
                          function move(offset: number) {
                            const next = [...topics]
                            const destination = index + offset
                            const other = next[destination]
                            if (!other) return
                            next[index] = other
                            next[destination] = topic
                            set(next)
                          }
                          return (
                            <div
                              className={styles.templateRow}
                              key={topic.id}
                              role="group"
                              aria-label={`Тема ${index + 1}`}
                            >
                              <div className={styles.templateOrder}>
                                <button
                                  type="button"
                                  aria-label={`Поднять тему ${index + 1}`}
                                  disabled={index === 0}
                                  onClick={() => move(-1)}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Опустить тему ${index + 1}`}
                                  disabled={index === topics.length - 1}
                                  onClick={() => move(1)}
                                >
                                  ↓
                                </button>
                              </div>
                              <div className={styles.templateFields}>
                                <label className={styles.templateTitle}>
                                  <span aria-hidden="true">{index + 1}.</span>
                                  <input
                                    aria-label="Название темы"
                                    placeholder="Название темы"
                                    required
                                    maxLength={300}
                                    value={topic.title}
                                    onChange={(event) => update({ title: event.target.value })}
                                  />
                                </label>
                                <textarea
                                  aria-label="Вопросы темы"
                                  maxLength={60029}
                                  placeholder="Вопросы, по одному на строку"
                                  rows={1}
                                  value={topic.prompts.join('\n')}
                                  onChange={(event) =>
                                    update({ prompts: event.target.value.split('\n') })
                                  }
                                />
                                <select
                                  aria-label="Формат ответа"
                                  value={topic.answer_mode ?? 'note'}
                                  onChange={(event) =>
                                    update({
                                      answer_mode:
                                        event.target.value === 'yes_no' ? 'yes_no' : 'note',
                                    })
                                  }
                                >
                                  <option value="note">Только заметка</option>
                                  <option value="yes_no">Да / нет / неизвестно и заметка</option>
                                </select>
                              </div>
                              <div className={styles.templateFields}>
                                <input
                                  aria-label="Лидер"
                                  maxLength={300}
                                  placeholder="Что предлагаем"
                                  value={topic.leader ?? ''}
                                  onChange={(event) => update({ leader: event.target.value })}
                                />
                                <textarea
                                  aria-label="Этапы теплоты"
                                  maxLength={323}
                                  placeholder="Этапы теплоты, по одному на строку"
                                  rows={1}
                                  value={topic.warmth_steps?.join('\n') ?? ''}
                                  onChange={(event) =>
                                    update({ warmth_steps: event.target.value.split('\n') })
                                  }
                                />
                              </div>
                              <div className={styles.templateFields}>
                                <textarea
                                  aria-label="Категории амоМаркета"
                                  maxLength={1451}
                                  placeholder="По одной на строку"
                                  rows={1}
                                  value={topic.market_categories?.join('\n') ?? ''}
                                  onChange={(event) =>
                                    update({ market_categories: event.target.value.split('\n') })
                                  }
                                />
                                <button
                                  type="button"
                                  onClick={() => set(topics.filter((item) => item.id !== topic.id))}
                                >
                                  Удалить тему
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <p className={styles.empty}>Тем пока нет.</p>
                    )}
                    <button
                      className={styles.templateAdd}
                      type="button"
                      onClick={() =>
                        set([...topics, { id: createRequestKey(), title: '', prompts: [] }])
                      }
                    >
                      Добавить тему
                    </button>
                  </div>
                )
              }}
            </AccountForm>
          ) : (
            <>
              <TemplatePreview topics={template.topics} />
              <div className={styles.templateDone}>
                <button type="button" data-variant="primary" onClick={close}>
                  Готово
                </button>
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  )
}
