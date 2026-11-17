import type { ReactNode } from 'react'
import { isUUID, record } from './installationsApi'
import { isAccountId } from './accountsApi'

export const accountTabs = {
  overview: 'Сводка',
  widgets: 'Наши виджеты',
  portrait: 'Портрет',
  history: 'История',
  users: 'Пользователи',
}
export type AccountTab = keyof typeof accountTabs

function isTab(value: string | null): value is AccountTab {
  return value !== null && Object.hasOwn(accountTabs, value)
}

export function getAccountLocation(search: string) {
  const params = new URLSearchParams(search)
  const id = params.get('account')?.toLowerCase()
  if (!isAccountId(id)) return null
  const tab = params.get('tab')
  return {
    id,
    tab: isTab(tab) ? tab : ('overview' as const),
    productCursor: params.get('widget_cursor') ?? '',
  }
}

export function accountSearch(search: string, id: string, tab: AccountTab = 'overview') {
  const params = new URLSearchParams(search)
  if (!isAccountId(params.get('account'))) {
    const priorTab = params.get('tab')
    if (priorTab !== null && !isTab(priorTab)) params.set('list_tab', priorTab)
    params.delete('widget_cursor')
  }
  params.set('account', id)
  params.set('tab', tab)
  return params.toString()
}

export function listSearch(search: string, section?: string) {
  const params = new URLSearchParams(search)
  if (isAccountId(params.get('account'))) {
    const priorTab = params.get('list_tab')
    if (priorTab !== null) params.set('tab', priorTab)
    else params.delete('tab')
    params.delete('list_tab')
    params.delete('widget_cursor')
    params.delete('account')
  }
  if (section) params.set('section', section)
  return params.toString()
}

export function ManagerLink({
  search,
  navigate,
  current,
  children,
}: {
  search: string
  navigate: (search: string) => void
  current?: boolean
  children: ReactNode
}) {
  return (
    <a
      href={search ? '?' + search : window.location.pathname}
      aria-current={current ? 'page' : undefined}
      onClick={(event) => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigate(search)
      }}
    >
      {children}
    </a>
  )
}

const accountFilters = [
  'q',
  'classification',
  'product_id',
  'active_users_min',
  'active_users_max',
  'sort',
  'limit',
  'cursor',
  'portrait',
] as const
type Filter = (typeof accountFilters)[number]
type Updates = Partial<Record<Filter, string | string[] | null>>

export const ratingField = '99a241de-d761-526b-bd53-184170aa88f2'

function validFilter(value: unknown, depth: number, budget: { leaves: number }): boolean {
  if (depth > 3) return false
  const node = record(value)
  if (Object.keys(node).length !== 1) return false
  const children = node.and ?? node.or
  if (Array.isArray(children)) {
    return (
      children.length > 0 &&
      children.length <= 30 &&
      children.every((item: unknown) => validFilter(item, depth + 1, budget))
    )
  }
  const predicate = record(node.condition)
  budget.leaves += 1
  return (
    budget.leaves <= 30 &&
    Object.keys(predicate).every((key) => ['field_id', 'op', 'value'].includes(key)) &&
    isUUID(predicate.field_id) &&
    typeof predicate.op === 'string' &&
    ['eq', 'in', 'exists', 'lt', 'gte'].includes(predicate.op)
  )
}

export function getAccountSearch(search: string) {
  const params = new URLSearchParams(search)
  const query = new URLSearchParams()
  for (const key of accountFilters) {
    if (key === 'portrait') continue
    for (const value of params.getAll('clients_' + key)) query.append(key, value)
  }
  const filter = params.get('clients_portrait')
  if (!filter) return { query, filter: null, invalid: false }
  try {
    if (filter.length <= 4000 && validFilter(JSON.parse(filter), 1, { leaves: 0 })) {
      return { query, filter, invalid: false }
    }
  } catch {
    // Reject malformed portal links before sending a request.
  }
  return { query, filter: null, invalid: true }
}

export function updateAccountSearch(search: string, updates: Updates) {
  const params = new URLSearchParams(search)
  for (const key of accountFilters) {
    const value = updates[key]
    if (value === undefined) continue
    const name = 'clients_' + key
    params.delete(name)
    if (Array.isArray(value)) {
      for (const item of value) if (item) params.append(name, item)
    } else if (value) params.set(name, value)
  }
  return params.toString()
}
