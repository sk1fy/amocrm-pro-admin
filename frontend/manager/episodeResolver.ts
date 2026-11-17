import { isUUID } from './installationsApi'
import { listWidgets, type AccountId } from './accountsApi'

export async function resolveEpisode(account: AccountId, episode: string, signal: AbortSignal) {
  if (!isUUID(episode)) throw new Error('Некорректный ID установки.')
  const deadline = AbortSignal.timeout(30_000)
  const combined = AbortSignal.any([signal, deadline])
  let cursor = '',
    snapshot: string | undefined,
    hash: string | undefined
  const cursors = new Set<string>()
  for (let page = 0; page < 100; page += 1) {
    combined.throwIfAborted()
    const result = await listWidgets(account, cursor, combined, { kind: 'allEpisodes' })
    combined.throwIfAborted()
    if (snapshot !== undefined && (snapshot !== result.snapshot_at || hash !== result.query_hash))
      throw new Error('Снимок установок изменился. Повторите поиск.')
    snapshot = result.snapshot_at
    hash = result.query_hash
    if (result.items.length > 100) throw new Error('Превышен размер страницы установок.')
    const row = result.items.find((item) => item.id === episode)
    if (row) return row
    if (!result.next_cursor) return null
    if (cursors.has(result.next_cursor)) throw new Error('Источник повторил курсор установок.')
    cursors.add(result.next_cursor)
    cursor = result.next_cursor
  }
  throw new Error('Достигнут предел поиска: 10 000 установок. Уточните запрос через поддержку.')
}
