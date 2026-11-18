import { afterEach, expect, it, vi } from 'vitest'
import { listWidgets, isAccountId } from './accountsApi'
import { parseInstallation } from './installationsApi'
import { resolveEpisode } from './episodeResolver'
vi.mock('./accountsApi', async (original) => ({
  ...(await original<typeof import('./accountsApi')>()),
  listWidgets: vi.fn(),
}))
const account = '661cf98b-8df1-42cc-beb4-443745c9a1c5'
if (!isAccountId(account)) throw new Error('invalid fixture')
const snapshot = { snapshot_at: '2026-11-17T00:00:00Z', query_hash: 'stable' }
const row = (id: string) => ({
  ...parseInstallation({
    id,
    account_id: account,
    amo_account_id: '9007199254740993',
    product_code: 'fixture',
    product_name: 'Fixture',
    generation: 1,
    kind: 'widget',
    installed_at: snapshot.snapshot_at,
    removed_at: snapshot.snapshot_at,
    last_lifecycle_event: 'uninstalled',
    lifecycle: 'closed',
    authorization: 'revoked',
    activation_status: 'unknown',
    review: { reviewed: false },
    access: {
      active: false,
      source: 'none',
      valid_until: null,
      own_until: null,
      computed_at: snapshot.snapshot_at,
    },
    version: 1,
  }),
  product_id: account,
  entitlement_version: 1,
})
const old = '11111111-1111-4111-8111-111111111111'
const page = (next_cursor: string | null, id: string = account) => ({
  ...snapshot,
  next_cursor,
  items: Array.from({ length: 100 }, () => row(id)),
})

afterEach(() => vi.resetAllMocks())
it('finds the exact old episode on the second 100-row page without current-product filtering', async () => {
  vi.mocked(listWidgets).mockResolvedValueOnce(page('next')).mockResolvedValueOnce(page(null, old))
  expect((await resolveEpisode(account, old, new AbortController().signal))?.id).toBe(old)
  expect(listWidgets).toHaveBeenNthCalledWith(2, account, 'next', expect.any(AbortSignal), {
    kind: 'allEpisodes',
  })
})
it('rejects changed query hashes and repeated cursors', async () => {
  vi.mocked(listWidgets)
    .mockResolvedValueOnce(page('next'))
    .mockResolvedValueOnce({ ...page(null), query_hash: 'different' })
  await expect(resolveEpisode(account, old, new AbortController().signal)).rejects.toThrow('Снимок')
  vi.mocked(listWidgets).mockResolvedValue(page('next'))
  await expect(resolveEpisode(account, old, new AbortController().signal)).rejects.toThrow('курсор')
})
it('honors cancellation before issuing any request and enforces the 100 page cap', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(resolveEpisode(account, old, controller.signal)).rejects.toThrow()
  expect(listWidgets).not.toHaveBeenCalled()
  let cursor = 0
  vi.mocked(listWidgets).mockImplementation(async () => page(String(++cursor)))
  await expect(resolveEpisode(account, old, new AbortController().signal)).rejects.toThrow('10 000')
  expect(listWidgets).toHaveBeenCalledTimes(100)
})
