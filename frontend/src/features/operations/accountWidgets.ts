import type { AccountCard } from '../../api/types'

/**
 * Connection id → widget (integration code) from the account card, so lists
 * of jobs and events name the widget instead of showing a UUID (ADR-0021).
 * Connections whose observation has no data are simply absent: callers fall
 * back to a neutral «Подключение».
 */
export function accountWidgetNames(account: AccountCard | undefined): Map<string, string> {
  const names = new Map<string, string>()
  for (const item of account?.connections ?? []) {
    if (item.data) {
      names.set(item.data.connection_id, item.data.integration_code)
    }
  }
  return names
}
