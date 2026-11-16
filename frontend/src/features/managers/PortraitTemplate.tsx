import { useId, useRef } from 'react'
import { type PortraitTopic } from './portraitTopics'
import styles from './Portrait.module.css'

export function PortraitTemplate({
  topics,
  changeTopics,
}: {
  topics: readonly PortraitTopic[]
  changeTopics: (topics: readonly PortraitTopic[]) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const headingId = useId()

  function moveTopic(index: number, offset: number) {
    const next = [...topics]
    const target = index + offset
    ;[next[index], next[target]] = [next[target], next[index]]
    changeTopics(next)
  }

  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        Шаблон тем
      </button>
      <dialog ref={dialog} aria-labelledby={headingId} className={styles.dialog}>
        <header className={styles.dialogHead}>
          <div>
            <h2 id={headingId}>Шаблон тем портрета</h2>
            <p>общий для всех клиентов · порядок — по марже, сверху самое выгодное</p>
          </div>
          <button
            type="button"
            aria-label="Закрыть шаблон тем"
            className={styles.close}
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </header>
        <div className={styles.dialogBody}>
          <div className={styles.templateTable}>
            <table>
              <colgroup>
                <col className={styles.positionColumn} />
                <col className={styles.questionColumn} />
                <col className={styles.leaderColumn} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Место</th>
                  <th scope="col">Тема и вопрос</th>
                  <th scope="col">Лидер — что предлагаем</th>
                  <th scope="col">Категории amoМаркета</th>
                </tr>
              </thead>
              <tbody>
                {topics.map((topic, index) => (
                  <tr key={topic.id}>
                    <td>
                      <div className={styles.orderButtons}>
                        <button
                          type="button"
                          aria-label={`Выше: ${topic.title}`}
                          disabled={index === 0}
                          onClick={() => moveTopic(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Ниже: ${topic.title}`}
                          disabled={index === topics.length - 1}
                          onClick={() => moveTopic(index, 1)}
                        >
                          ↓
                        </button>
                      </div>
                    </td>
                    <td>
                      <span>
                        {index + 1}. {topic.title}
                      </span>
                      <input
                        aria-label={`Вопрос: ${topic.title}`}
                        value={topic.question}
                        onChange={(event) =>
                          changeTopics(
                            topics.map((item) =>
                              item.id === topic.id
                                ? { ...item, question: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                      <small>
                        {topic.yesNo ? 'да / нет / неизвестно + заметка' : 'только заметка'}
                      </small>
                    </td>
                    <td>
                      {topic.leader === undefined ? (
                        <small>{topic.hint}</small>
                      ) : (
                        <>
                          <input
                            aria-label={`Лидер: ${topic.title}`}
                            value={topic.leader}
                            onChange={(event) =>
                              changeTopics(
                                topics.map((item) =>
                                  item.id === topic.id
                                    ? { ...item, leader: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                          <small>
                            {topic.partner
                              ? 'сам ведёт клиента — без «Показали»'
                              : 'теплота: 4 шага'}
                          </small>
                        </>
                      )}
                    </td>
                    <td>{topic.category ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.hint}>
            Категории amoМаркета показывают, какие партнёрские виджеты относятся к теме.
          </p>
        </div>
        <footer className={styles.dialogFoot}>
          <span className={styles.hint}>Изменения применяются сразу в демо.</span>
          <button type="button" data-variant="primary" onClick={() => dialog.current?.close()}>
            Готово
          </button>
        </footer>
      </dialog>
    </>
  )
}
