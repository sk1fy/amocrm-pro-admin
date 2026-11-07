export type Breadcrumb = {
  label: string
  href?: string
  mono: boolean
}

const crumbLabels: Record<string, string> = {
  accounts: 'Аккаунты',
  widgets: 'Виджеты',
  operations: 'Операции',
  system: 'Система',
  employees: 'Сотрудники',
  sessions: 'Сессии',
  audit: 'Аудит',
  settings: 'Настройки',
  stats: 'Статистика',
  history: 'История',
  admin: 'Команды',
}

type Override = { skip: true } | { label: string; mono: boolean }

// Backend codes and UUIDs are technical details (ADR-0021): the trail names
// the object kind instead; the page header shows its human name.
function overrideFor(segments: string[], index: number): Override | null {
  const [root, , section] = segments
  if (root === 'accounts' && section === 'widgets') {
    if (index === 3) return { skip: true }
    if (index === 4) return { label: 'Подключение', mono: false }
  }
  if (root === 'widgets') {
    if (index === 1) return { skip: true }
    if (index === 2) return { label: 'Интеграция', mono: false }
  }
  if (root === 'operations' && segments[1] === 'admin' && index === 2) {
    return { label: 'Операция', mono: false }
  }
  return null
}

export function breadcrumbsFor(pathname: string): Breadcrumb[] {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) {
    return [{ label: 'Обзор', mono: false }]
  }
  const crumbs: Breadcrumb[] = [{ label: 'Обзор', href: '/', mono: false }]
  let acc = ''
  segments.forEach((segment, index) => {
    acc += `/${segment}`
    const last = index === segments.length - 1
    const override = overrideFor(segments, index)
    if (override && 'skip' in override) {
      return
    }
    crumbs.push({
      label: override?.label ?? crumbLabels[segment] ?? segment,
      href: last ? undefined : acc,
      mono: override ? override.mono : !(segment in crumbLabels),
    })
  })
  return crumbs
}
