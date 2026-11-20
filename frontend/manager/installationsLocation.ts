import { useEffect, useState } from 'react'

export const installationFilters = [
  'q',
  'review',
  'kind',
  'last_lifecycle_event',
  'product_id',
  'line',
  'activation',
  'access_state',
  'from',
  'to',
  'sort',
  'limit',
  'cursor',
] as const

type Filter = (typeof installationFilters)[number]
type FilterUpdate = Partial<Record<Filter, string | null>>

export function getInstallationSearch(search: string): URLSearchParams {
  const location = new URLSearchParams(search)
  const filters = new URLSearchParams()
  for (const key of installationFilters) {
    for (const value of location.getAll(key)) filters.append(key, value)
  }
  return filters
}

export function updateInstallationSearch(search: string, update: FilterUpdate): string {
  const params = new URLSearchParams(search)
  for (const key of installationFilters) {
    const value = update[key]
    if (value === undefined) continue
    if (value === null || value === '') params.delete(key)
    else params.set(key, value)
  }
  return params.toString()
}

function managerSearch(search: string) {
  const params = new URLSearchParams(search)
  const section = params.get('section')
  if (
    section !== 'companies' &&
    !(section === 'clients' && (params.get('clients_tab') === 'companies' || params.has('company')))
  ) {
    return search
  }
  params.set('section', 'clients')
  for (const key of [
    'company',
    'clients_tab',
    'companies_q',
    'companies_cursor',
    'companies_limit',
  ]) {
    params.delete(key)
  }
  return '?' + params.toString()
}

export function useManagerLocation() {
  const [search, setSearch] = useState(() => managerSearch(window.location.search))
  useEffect(() => {
    const onPopState = () => {
      const url = new URL(window.location.href)
      const next = managerSearch(url.search)
      if (url.search !== next) {
        url.search = next
        window.history.replaceState(window.history.state, '', url)
      }
      setSearch(next)
    }
    onPopState()
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  function navigate(search: string, replace = false) {
    const url = new URL(window.location.href)
    url.search = managerSearch(search)
    if (url.href === window.location.href) return
    if (replace) window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
    setSearch(url.search)
  }

  function updateFilters(update: FilterUpdate, replace = false) {
    navigate(updateInstallationSearch(window.location.search, update), replace)
  }

  return { search, updateFilters, navigate }
}
