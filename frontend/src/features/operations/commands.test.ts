import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectionCommand, jobPending, operationPending, safeOperationURL } from './commands'
import { createRequestKey, intentStorageKey, readIntent, writeIntent } from './intents'

afterEach(() => vi.unstubAllGlobals())

describe('operation safety', () => {
  it('keeps watching queued and processing jobs until a terminal state', () => {
    for (const status of ['queued', 'processing', 'retry']) expect(jobPending(status)).toBe(true)
    for (const status of ['completed', 'failed', 'dead', 'cancelled', 'unknown', undefined])
      expect(jobPending(status)).toBe(false)
  })
  it('generates distinct UUIDv4 request keys on HTTP origins without randomUUID', () => {
    let nonce = 0
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(++nonce)
        return bytes
      },
    })
    const first = createRequestKey()
    const second = createRequestKey()
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(second).not.toBe(first)
  })
  it('does not poll unknown or partial results as successful operations', () => {
    for (const state of ['accepted', 'pending', 'running'])
      expect(operationPending(state)).toBe(true)
    for (const state of ['succeeded', 'failed', 'partial', 'unknown_outcome', undefined])
      expect(operationPending(state)).toBe(false)
  })
  it('only exposes HTTP OAuth links', () => {
    expect(safeOperationURL('javascript:alert(1)')).toBeUndefined()
    expect(safeOperationURL('data:text/html,test')).toBeUndefined()
    expect(safeOperationURL('https://oauth.example.invalid/start')).toBe(
      'https://oauth.example.invalid/start',
    )
  })
  it('persists receipt identifiers without restoring injected payload or secret fields', () => {
    const key = intentStorageKey('employee-one', '/commands/revoke')
    sessionStorage.setItem(
      key,
      JSON.stringify({
        requestKey: 'request-one',
        operationId: 'operation-one',
        payload: { client_secret: 'fixture-secret' },
      }),
    )
    expect(readIntent(key)).toEqual({ requestKey: 'request-one', operationId: 'operation-one' })
    writeIntent(key, { requestKey: 'request-two' })
    expect(sessionStorage.getItem(key)).not.toContain('fixture-secret')
    expect(intentStorageKey('employee-two', '/commands/revoke')).not.toBe(key)
    writeIntent(key, null)
    expect(readIntent(key)).toBeNull()
  })
  it('separates local revoke and installation scope from integration management', () => {
    const revoke = connectionCommand('core', 'installation-one', 'revoke', '91000002')
    expect(revoke.permission).toBe('connections:revoke')
    expect(revoke.nextStep).toContain('OAuth')
    expect(revoke.scope).toContain('Локальные')
    expect(connectionCommand('core', 'installation-one', 'uninstall').permission).toBe(
      'connections:uninstall',
    )
  })
})
