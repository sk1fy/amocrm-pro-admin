import { StatusBadge } from '../src/components/StatusBadge'
import type { Installation } from './installationsApi'

export function WidgetAccessStatus({ access }: { access: Installation['access'] }) {
  const state = !access.active ? 'inactive' : access.source === 'own_trial' ? 'trial' : 'active'
  return <StatusBadge domain="product_access" state={state} calm />
}
