import { describe, expect, it } from 'vitest'
import { breadcrumbsFor } from './crumbs'

describe('breadcrumbsFor', () => {
  it('keeps overview as the current crumb without a self-link', () => {
    expect(breadcrumbsFor('/')).toEqual([{ label: 'Обзор', mono: false }])
  })

  it('links ancestors and leaves the current page as text', () => {
    expect(breadcrumbsFor('/accounts')).toEqual([
      { label: 'Обзор', href: '/', mono: false },
      { label: 'Аккаунты', mono: false },
    ])
    expect(breadcrumbsFor('/accounts/91000001/widgets')).toEqual([
      { label: 'Обзор', href: '/', mono: false },
      { label: 'Аккаунты', href: '/accounts', mono: false },
      { label: '91000001', href: '/accounts/91000001', mono: true },
      { label: 'Виджеты', mono: false },
    ])
  })

  it('uses a visible trail for system children', () => {
    const crumbs = breadcrumbsFor('/system/employees')
    expect(crumbs.map((crumb) => crumb.label)).toEqual(['Обзор', 'Система', 'Сотрудники'])
    expect(crumbs[1]?.href).toBe('/system')
    expect(crumbs[2]?.href).toBeUndefined()
  })
})
