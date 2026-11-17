import { useCallback, useEffect, useRef, useState } from 'react'
import { createRequestKey } from '../src/features/operations/intents'
import { isApiError, isForbidden, isUnauthorized } from '../src/api/client'
import {
  getReviewReceipt,
  submitReview,
  type Installation,
  type ReviewCommand,
  type ReviewResult,
} from './installationsApi'

type PendingReview = {
  command: ReviewCommand
  operationId?: Extract<ReviewResult, { kind: 'pending' }>['operationId']
  retryNotBefore?: number
}

type ReviewState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'uncertain'; pending: PendingReview }
  | { kind: 'notice'; message: string; error: boolean }

const reviewBudgetMs = 15_000
const pollIntervalMs = 750

function waitUntil(deadline: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    let timer: number | undefined
    function tick() {
      const remaining = deadline - performance.now()
      if (remaining > 0) {
        timer = window.setTimeout(tick, Math.min(Math.ceil(remaining), 2_147_483_647))
        return
      }
      signal.removeEventListener('abort', abort)
      resolve()
    }
    function abort() {
      window.clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    tick()
  })
}

export function useInstallationReview({
  onAccessError,
  refresh,
}: {
  onAccessError: (error: unknown) => void
  refresh: () => void
}) {
  const [state, setState] = useState<ReviewState>({ kind: 'idle' })
  const request = useRef<AbortController | null>(null)

  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (state.kind !== 'uncertain' || state.pending.retryNotBefore === undefined) return
    const controller = new AbortController()
    void waitUntil(state.pending.retryNotBefore, controller.signal).then(
      () => {
        setState((current) =>
          current === state
            ? { kind: 'uncertain', pending: { ...state.pending, retryNotBefore: undefined } }
            : current,
        )
      },
      () => undefined,
    )
    return () => controller.abort()
  }, [state])

  const cancel = useCallback(() => {
    request.current?.abort()
    setState({ kind: 'idle' })
  }, [])

  async function run(original: PendingReview) {
    if (request.current || (original.retryNotBefore ?? 0) > performance.now()) return
    const controller = new AbortController()
    request.current = controller
    const expiresAt = performance.now() + reviewBudgetMs
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(reviewBudgetMs)])
    setState({ kind: 'checking' })
    let pending = original
    let observing = false

    function complete() {
      refresh()
      setState({ kind: 'notice', message: 'Отметка проверки сохранена.', error: false })
    }

    try {
      const result = await submitReview(pending.command, signal)
      if (result.kind === 'completed') {
        complete()
        return
      }
      pending = { ...pending, retryNotBefore: result.retryNotBefore }
      if (pending.operationId && result.operationId !== pending.operationId) {
        throw new Error('review receipt ID changed')
      }

      const operationId = result.operationId
      pending = { ...pending, operationId }
      if (pending.retryNotBefore !== undefined && pending.retryNotBefore >= expiresAt) {
        setState({ kind: 'uncertain', pending })
        return
      }
      observing = true
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await waitUntil(
          Math.max(performance.now() + pollIntervalMs, pending.retryNotBefore ?? 0),
          signal,
        )
        const receipt = await getReviewReceipt(operationId, signal)
        if (receipt === 'completed') {
          complete()
          return
        }
        if (receipt === 'rejected') {
          refresh()
          setState({ kind: 'notice', message: 'Изменение отметки отклонено.', error: true })
          return
        }
      }
      setState({ kind: 'uncertain', pending })
    } catch (error) {
      if (controller.signal.aborted) return
      if (isUnauthorized(error) || isForbidden(error)) {
        onAccessError(error)
        return
      }
      if (!observing && isApiError(error)) {
        if (error.status === 409 && error.detailCode === 'version_conflict') {
          refresh()
          setState({
            kind: 'notice',
            message: 'Отметка уже изменилась. Проверьте новые данные перед следующей попыткой.',
            error: true,
          })
          return
        }
        if ([400, 404, 409, 422].includes(error.status)) {
          setState({
            kind: 'notice',
            message: 'Не удалось изменить отметку проверки.',
            error: true,
          })
          return
        }
      }
      if (isApiError(error) && error.retryNotBefore !== undefined) {
        pending = { ...pending, retryNotBefore: error.retryNotBefore }
      }
      setState({ kind: 'uncertain', pending })
    } finally {
      request.current = null
    }
  }

  function start(row: Installation) {
    if (state.kind === 'checking' || state.kind === 'uncertain' || request.current) return
    void run({
      command: {
        installationId: row.id,
        reviewed: !row.review.reviewed,
        key: createRequestKey(),
        version: row.version,
      },
    })
  }

  function retry() {
    if (state.kind === 'uncertain') void run(state.pending)
  }

  const retryBlocked = state.kind === 'uncertain' && state.pending.retryNotBefore !== undefined
  return { state, start, retry, cancel, retryBlocked }
}
