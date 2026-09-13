import { describe, expect, it } from 'vitest'
import type { BackendRegistryEntry } from '../../../api/types'
import { resolveConnectionModule } from './registry'

function entry(overrides: Partial<BackendRegistryEntry> = {}): BackendRegistryEntry {
  return {
    backend: 'core',
    kind: 'fixture',
    display_name: 'Fixture Core',
    products: [{ code: 'activity', display_name: 'Активность сотрудников' }],
    status: 'available',
    contract_version: 'v1',
    revision: 'fixture',
    adapter_capabilities: ['accounts', 'settings'],
    backend_capabilities: ['accounts'],
    observed_at: '2026-09-13T10:00:00Z',
    checked_at: '2026-09-13T10:05:00Z',
    ...overrides,
  }
}

describe('resolveConnectionModule', () => {
  it('maps activity and lead-status products to the activity module', () => {
    expect(resolveConnectionModule('core', [entry()])).toEqual({ kind: 'activity' })
    expect(
      resolveConnectionModule('core', [
        entry({ products: [{ code: 'lead-status', display_name: 'Статусы сделок' }] }),
      ]),
    ).toEqual({ kind: 'activity' })
  })

  it('reports a known module backend without settings as unsupported', () => {
    const moduleBackend = entry({
      backend: 'fixture',
      products: [{ code: 'fixture-module', display_name: 'Демонстрационный модуль' }],
      adapter_capabilities: ['accounts', 'connections'],
    })
    expect(resolveConnectionModule('fixture', [moduleBackend])).toEqual({ kind: 'unsupported' })
  })

  it('requires the settings capability in addition to the activity product', () => {
    const noSettings = entry({
      products: [{ code: 'activity', display_name: 'Активность сотрудников' }],
      adapter_capabilities: ['accounts', 'connections'],
    })
    expect(resolveConnectionModule('core', [noSettings])).toEqual({ kind: 'unsupported' })
  })

  it('reports an unknown backend as unknown even when other entries are loaded', () => {
    expect(resolveConnectionModule('legacy', [entry()])).toEqual({ kind: 'unknown-backend' })
  })

  it('reports no backends loaded as unknown', () => {
    expect(resolveConnectionModule('core', undefined)).toEqual({ kind: 'unknown-backend' })
    expect(resolveConnectionModule('core', [])).toEqual({ kind: 'unknown-backend' })
  })
})
