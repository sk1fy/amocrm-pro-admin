import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, type FormEvent } from 'react'
import { accountsKey, ReadFailure, useAccountAccessError, type AccountAccess } from './AccountsPage'
import { listNiches } from './accountsApi'
import { nicheField, ratingField } from './accountsLocation'
import { isUUID, record } from './installationsApi'
import { maturitySignals } from './portraitSignals'
import styles from './ClientsDirectory.module.css'

type Criteria = {
  rating?: string
  niche?: string
  signal?: string
  answer?: string
}

function editableCriteria(filter: string | null): Criteria | null {
  if (!filter) return {}
  const root = record(JSON.parse(filter))
  const conditions = Array.isArray(root.and) ? root.and : [root]
  const criteria: Criteria = {}
  for (const clause of conditions) {
    const node = record(clause)
    if (!node.condition) return null
    const { field_id: id, op, value } = record(node.condition)
    if (id === ratingField && op === 'gte' && typeof value === 'number' && !criteria.rating) {
      criteria.rating = String(value)
    } else if (id === nicheField && op === 'eq' && isUUID(value) && !criteria.niche) {
      criteria.niche = value
    } else if (
      typeof id === 'string' &&
      maturitySignals.some(([signal]) => signal === id) &&
      !criteria.signal &&
      (op === 'eq' || (op === 'exists' && value === false)) &&
      typeof value === 'boolean'
    ) {
      criteria.signal = id
      criteria.answer = op === 'exists' ? 'unknown' : String(value)
    } else {
      return null
    }
  }
  return criteria
}

function portraitFilter(criteria: Criteria) {
  const conditions: {
    condition: { field_id: string; op: string; value: string | number | boolean }
  }[] = []
  if (criteria.rating) {
    conditions.push({
      condition: { field_id: ratingField, op: 'gte', value: Number(criteria.rating) },
    })
  }
  if (criteria.niche) {
    conditions.push({ condition: { field_id: nicheField, op: 'eq', value: criteria.niche } })
  }
  if (criteria.signal) {
    conditions.push({
      condition: {
        field_id: criteria.signal,
        op: criteria.answer === 'unknown' ? 'exists' : 'eq',
        value: criteria.answer === 'true',
      },
    })
  }
  if (!conditions.length) return null
  return JSON.stringify(conditions.length === 1 ? conditions[0] : { and: conditions })
}

export function ClientPortraitFilter({
  filter,
  scope,
  onExpired,
  onForbidden,
  close,
  apply,
}: AccountAccess & {
  filter: string | null
  close: () => void
  apply: (filter: string | null) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const unavailableId = useId()

  useEffect(() => {
    const node = dialog.current
    if (node && !node.open) node.showModal()
  }, [])

  const current = editableCriteria(filter)
  const niches = useInfiniteQuery({
    queryKey: [...accountsKey, scope, 'niches'],
    queryFn: ({ pageParam, signal }) => listNiches(pageParam, signal),
    initialPageParam: '',
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    retry: false,
  })
  useAccountAccessError(niches.error, onExpired, onForbidden)
  const availableNiches = niches.data?.pages.flatMap((page) => page.items) ?? []
  const ratingOptions = ['0', '1', '2', '3', '4', '5']
  if (current?.rating && !ratingOptions.includes(current.rating)) ratingOptions.push(current.rating)

  function dismiss() {
    dialog.current?.close()
  }

  function applyFilter(value: string | null) {
    dismiss()
    apply(value)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    applyFilter(
      portraitFilter({
        rating: String(fields.get('rating') ?? ''),
        niche: String(fields.get('niche') ?? ''),
        signal: String(fields.get('signal') ?? ''),
        answer: String(fields.get('answer') ?? ''),
      }),
    )
  }

  return (
    <dialog
      ref={dialog}
      className={styles.portraitDialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={close}
    >
      <header className={styles.portraitHeader}>
        <div>
          <h2 id={titleId}>Клиенты по портрету</h2>
          <p id={descriptionId}>Фильтр по темам, нише и рейтингу клиента</p>
        </div>
        <button
          type="button"
          className={styles.portraitClose}
          aria-label="Закрыть"
          onClick={dismiss}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="m4 4 8 8m0-8-8 8" />
          </svg>
        </button>
      </header>
      <form onSubmit={submit}>
        <div className={styles.portraitForm}>
          {filter && !current ? <p>Новые условия заменят текущий фильтр.</p> : null}
          <div className={styles.portraitPair}>
            <label>
              Тема
              <select name="signal" defaultValue={current?.signal ?? ''}>
                <option value="">Любая</option>
                {maturitySignals.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Условие
              <select name="answer" defaultValue={current?.answer ?? 'true'}>
                <option value="true">Да</option>
                <option value="false">Нет</option>
                <option value="unknown">Не указано</option>
              </select>
            </label>
          </div>
          <div className={styles.portraitPair}>
            <label>
              Дата отметки или аудита с
              <input type="date" disabled aria-describedby={unavailableId} />
            </label>
            <label>
              По
              <input
                type="date"
                aria-label="Дата отметки или аудита по"
                disabled
                aria-describedby={unavailableId}
              />
            </label>
          </div>
          <div className={styles.portraitPair}>
            <label>
              Ниша
              <select name="niche" defaultValue={current?.niche ?? ''}>
                <option value="">Любая</option>
                {current?.niche && !availableNiches.some((niche) => niche.id === current.niche) ? (
                  <option value={current.niche}>Выбранная ниша</option>
                ) : null}
                {availableNiches.map((niche) => (
                  <option key={niche.id} value={niche.id}>
                    {niche.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Рейтинг
              <select name="rating" defaultValue={current?.rating ?? ''}>
                <option value="">Любой</option>
                {ratingOptions.map((rating) => (
                  <option key={rating} value={rating}>
                    От {rating}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {niches.isPending ? <p role="status">Загружаем ниши…</p> : null}
          {niches.isError ? (
            <ReadFailure error={niches.error} retry={() => void niches.refetch()} />
          ) : null}
          {niches.hasNextPage ? (
            <button
              type="button"
              disabled={niches.isFetchingNextPage}
              onClick={() => void niches.fetchNextPage()}
            >
              Ещё ниши
            </button>
          ) : null}
          <label>
            Текст в заметках, паспорте и аудитах
            <input
              type="search"
              placeholder="Например, Tilda"
              disabled
              aria-describedby={unavailableId}
            />
          </label>
          <p id={unavailableId}>Фильтр по датам и поиск по заметкам пока недоступны.</p>
        </div>
        <footer className={styles.portraitActions}>
          {filter ? (
            <button type="button" onClick={() => applyFilter(null)}>
              Сбросить фильтр
            </button>
          ) : null}
          <button type="button" onClick={dismiss}>
            Отмена
          </button>
          <button type="submit" data-variant="primary">
            Показать клиентов
          </button>
        </footer>
      </form>
    </dialog>
  )
}
