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
    crumbs.push({
      label: crumbLabels[segment] ?? segment,
      href: last ? undefined : acc,
      mono: !(segment in crumbLabels),
    })
  })
  return crumbs
}
