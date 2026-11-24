import type { CompanyWorkflow } from './companyApi'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { isApiError } from '../src/api/client'
import { checkAccountCommand, sendAccountCommand, type ManagerCommand } from './accountsApi'
import type { Product } from './productsApi'
import styles from './Accounts.module.css'

type Values = Record<string, string>
type Draft = { values: Values; base: number; original: Values }
type Pending = { command: ManagerCommand; id?: string; retryAt?: number; status?: string }

type CommandState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'pending'; pending: Pending }
  | { kind: 'conflict'; version?: number; assertion?: boolean }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }

type Entry = { draft?: Draft; state: CommandState }
const emptyEntry: Entry = { state: { kind: 'idle' } }

type CommandStore = {
  entries: Record<string, Entry>
  update: (id: string, action: (entry: Entry) => Entry) => void
  requests: Map<string, AbortController>
}
const Commands = createContext<CommandStore | null>(null)

export function AccountCommands({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, Entry>>({})
  const requests = useRef(new Map<string, AbortController>()).current
  useEffect(
    () => () => {
      for (const request of requests.values()) request.abort()
      requests.clear()
    },
    [requests],
  )
  const store = useMemo<CommandStore>(
    () => ({
      entries,
      requests,
      update: (id, action) =>
        setEntries((current) => ({ ...current, [id]: action(current[id] ?? emptyEntry) })),
    }),
    [entries, requests],
  )
  return <Commands.Provider value={store}>{children}</Commands.Provider>
}

export function useAccountCommand(
  id: string,
  options: {
    onSaved: (product?: Product) => void
    onWorkflowSaved?: (workflow: CompanyWorkflow) => void
    onExpired: () => void
    onForbidden: () => void
  },
) {
  const store = useContext(Commands)
  if (!store) throw new Error('account commands missing')
  const entry = store.entries[id] ?? emptyEntry
  const [clock, setClock] = useState(() => performance.now())
  const pending = entry.state.kind === 'pending' ? entry.state.pending : null
  const retryAt = pending?.retryAt
  useEffect(() => {
    if (retryAt === undefined || retryAt <= clock) return
    const timer = window.setTimeout(
      () => setClock(performance.now()),
      Math.max(0, Math.min(retryAt - performance.now(), 2_147_483_647)),
    )
    return () => window.clearTimeout(timer)
  }, [retryAt, clock])

  function setState(state: CommandState, clearDraft = false) {
    store?.update(id, (previous) => ({ state, draft: clearDraft ? undefined : previous.draft }))
  }

  async function run(original: Pending, poll: boolean) {
    if (!store || store.requests.has(id) || (original.retryAt ?? 0) > performance.now()) return
    const request = new AbortController()
    store.requests.set(id, request)
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)])
    setState({ kind: 'busy' })
    try {
      let result =
        poll && original.id
          ? await checkAccountCommand(original.command, original.id, signal)
          : await sendAccountCommand(original.command, signal)
      if (request.signal.aborted) return
      if (
        poll &&
        result.kind === 'completed' &&
        (original.command.kind === 'product-create' ||
          original.command.kind === 'product-update' ||
          original.command.kind === 'company-workflow')
      ) {
        result = await sendAccountCommand(original.command, signal)
        if (request.signal.aborted) return
      }
      if (result.kind === 'workflow-saved') {
        setState({ kind: 'saved' }, true)
        options.onWorkflowSaved?.(result.workflow)
      } else if (result.kind === 'completed') {
        setState({ kind: 'saved' }, true)
        options.onSaved(result.product)
      } else if (result.kind === 'rejected') {
        setState({ kind: 'error', message: 'Команда отклонена. Черновик сохранён.' })
        options.onSaved()
      } else {
        if (original.id && original.id !== result.id) {
          setState({ kind: 'pending', pending: original })
          return
        }
        setState({
          kind: 'pending',
          pending: { ...original, id: result.id, retryAt: result.retryAt, status: result.state },
        })
      }
    } catch (error) {
      if (request.signal.aborted) return
      if (isApiError(error)) {
        if (error.status === 401) options.onExpired()
        if (error.status === 403) options.onForbidden()
        if (
          !poll &&
          error.status === 409 &&
          ['version_conflict', 'company_source_conflict', 'company_metadata_conflict'].includes(
            error.detailCode ?? '',
          )
        ) {
          setState({
            kind: 'conflict',
            version: error.currentVersion,
            assertion: error.detailCode !== 'version_conflict',
          })
          options.onSaved()
          return
        }
        const definitive =
          !poll &&
          ([400, 409, 422].includes(error.status) || (error.status === 404 && !original.status))
        if (
          definitive ||
          (!original.id && original.status === undefined && !poll && error.status === 403)
        ) {
          setState({
            kind: 'error',
            message:
              error.detailCode === 'integration_mapping_mismatch'
                ? 'Проверьте UUID в технической админке. Интеграция должна быть активна и свободна для привязки. Если её только что создали, повторите через несколько секунд.'
                : error.detailCode === 'target_not_extended'
                  ? 'Новый срок должен быть позже текущего.'
                  : error.status === 403
                    ? 'Нет права на изменение.'
                    : 'Не удалось сохранить изменение. Черновик сохранён.',
          })
          return
        }
      }
      setState({
        kind: 'pending',
        pending: {
          ...original,
          status: 'unknown_outcome',
          retryAt: isApiError(error) ? error.retryNotBefore : undefined,
        },
      })
    } finally {
      store.requests.delete(id)
    }
  }

  useEffect(() => {
    if (!pending?.id || pending.status === 'unknown_outcome') return
    const wait = Math.max(1000, (pending.retryAt ?? 0) - performance.now())
    const timer = window.setTimeout(() => void run(pending, true), Math.min(wait, 2_147_483_647))
    return () => window.clearTimeout(timer)
    // A new receipt replaces the pending value and schedules the next poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  return {
    entry,
    locked: entry.state.kind === 'busy' || entry.state.kind === 'pending',
    start: (command: ManagerCommand) => {
      if (entry.state.kind !== 'conflict' && entry.state.kind !== 'pending')
        void run({ command }, false)
    },
    check: () => {
      if (pending?.id) void run(pending, true)
    },
    retry: () => {
      if (pending) void run(pending, false)
    },
    retryBlocked: retryAt !== undefined && retryAt > clock,
    edit: (name: string, value: string, initial: Values, version: number) =>
      store.update(id, (previous) => ({
        state:
          previous.state.kind === 'saved' || previous.state.kind === 'error'
            ? { kind: 'idle' }
            : previous.state,
        draft: {
          original: previous.draft?.original ?? initial,
          base: previous.draft?.base ?? version,
          values: { ...(previous.draft?.values ?? initial), [name]: value },
        },
      })),
    discardDraft: () => {
      if (entry.state.kind !== 'busy' && entry.state.kind !== 'pending')
        store.update(id, () => emptyEntry)
    },
    rebase: (version: number, latest: Values) =>
      store.update(id, (previous) => {
        if (
          !previous.draft ||
          previous.state.kind !== 'conflict' ||
          (previous.state.version !== undefined && version < previous.state.version) ||
          version < previous.draft.base ||
          (version === previous.draft.base && !previous.state.assertion)
        )
          return previous
        const { original, values } = previous.draft
        const edits = Object.fromEntries(
          Object.entries(values).filter(([key, value]) => value !== original[key]),
        )
        return {
          state: { kind: 'idle' },
          draft: { base: version, original: latest, values: { ...latest, ...edits } },
        }
      }),
  }
}

type EditorCommand = ReturnType<typeof useAccountCommand>

export function CommandFeedback({ command }: { command: EditorCommand }) {
  const state = command.entry.state
  if (state.kind === 'idle' || state.kind === 'conflict') return null
  if (state.kind === 'saved') return <p role="status">Сохранено.</p>
  if (state.kind === 'busy') return <p role="status">Проверяем результат команды…</p>
  if (state.kind === 'error') return <p role="alert">{state.message}</p>
  const pending = state.pending
  return (
    <div className={styles.form}>
      <p role="status">
        {pending.status === 'waiting_external'
          ? 'Ожидаем ответа источника.'
          : pending.status === 'accepted' || pending.status === 'running'
            ? 'Обновление выполняется.'
            : 'Результат команды пока неизвестен.'}
      </p>
      <div className={styles.actions}>
        {pending.id ? (
          <button type="button" onClick={command.check} disabled={command.retryBlocked}>
            Проверить результат
          </button>
        ) : null}
        <button type="button" onClick={command.retry} disabled={command.retryBlocked}>
          Повторить ту же команду
        </button>
      </div>
    </div>
  )
}

export function VersionConflict({
  command,
  version,
  latest,
  children,
}: {
  command: EditorCommand
  version: number
  latest: Values
  children?: ReactNode
}) {
  const { draft, state } = command.entry
  if (!draft || state.kind !== 'conflict') return null
  const ready =
    (version > draft.base || (state.assertion && version === draft.base)) &&
    (state.version === undefined || version >= state.version)
  return (
    <div className={styles.form}>
      <p role="alert">
        Версия изменилась. Черновик сохранён. Текущая версия {state.version ?? version}.
      </p>
      {children}
      <div className={styles.actions}>
        <button type="button" onClick={() => command.rebase(version, latest)} disabled={!ready}>
          Применить черновик к текущей версии
        </button>
      </div>
    </div>
  )
}
