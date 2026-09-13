import type { BackendRegistryEntry } from '../../../api/types'

const activityModuleProducts = new Set(['activity', 'lead-status'])

export type ConnectionModuleResolution =
  | { kind: 'activity' }
  | { kind: 'unsupported' }
  | { kind: 'unknown-backend' }

export function resolveConnectionModule(
  backend: string,
  entries: BackendRegistryEntry[] | undefined,
): ConnectionModuleResolution {
  const entry = entries?.find((item) => item.backend === backend)
  if (!entry) {
    return { kind: 'unknown-backend' }
  }
  if (
    entry.products.some((product) => activityModuleProducts.has(product.code)) &&
    entry.adapter_capabilities.includes('settings')
  ) {
    return { kind: 'activity' }
  }
  return { kind: 'unsupported' }
}
