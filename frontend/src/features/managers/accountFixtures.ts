import { clients, dateLabel, type Cell, type DemoRow } from './fixtures'
import { legacyMarketWidgets, marketWidgets } from './marketFixtures'

export type DemoClient = (typeof clients)[number]

export type DemoUser = {
  id: string
  name: string
  team: string
  email: string
  phone: string
  admin: boolean
  active: boolean
  added: string
}

export type SeenWidget = {
  code: string
  name: string
  owner: string
  firstSeen: string
  gone: boolean
}

export type DemoEvent = {
  id: string
  date: string
  kind: 'install' | 'payment' | 'edit'
  title: string
  widget: string
  details: string
  actor: string
}

function cellText(cell: Cell | undefined) {
  return typeof cell === 'string' ? cell : (cell?.text ?? '—')
}

export function accountTabData(
  client: DemoClient,
  installs: readonly DemoRow[],
  invoices: readonly DemoRow[],
) {
  const users: DemoUser[] = [
    {
      id: `${client.id}-1`,
      name: 'Алексей Ветров',
      team: 'Руководство',
      email: client.email,
      phone: '',
      admin: true,
      active: true,
      added: '2024-09-08',
    },
    {
      id: `${client.id}-2`,
      name: 'Мария Лесная',
      team: 'Отдел продаж',
      email: `sales@${client.domain}.example.invalid`,
      phone: '+7 (000) 000-11-02',
      admin: false,
      active: true,
      added: '2024-10-01',
    },
    {
      id: `${client.id}-3`,
      name: 'Кирилл Озёрный',
      team: 'Техподдержка',
      email: `help@${client.domain}.example.invalid`,
      phone: '',
      admin: false,
      active: false,
      added: '2024-06-30',
    },
  ]
  const accountId = Number(client.id)
  const seen: SeenWidget[] = [
    ...installs.map((install) => ({
      code: `rkrs_demo_${install.id.slice(8)}`,
      name: cellText(install.cells[1]),
      owner: 'Наш новый',
      firstSeen: install.date ?? '',
      gone: false,
    })),
    ...[...marketWidgets, ...Object.values(legacyMarketWidgets)]
      .filter((widget) => widget.accounts.includes(accountId) || widget.removed.includes(accountId))
      .filter((widget) => !installs.some((install) => cellText(install.cells[1]) === widget.name))
      .map((widget) => ({
        code: widget.code,
        name: widget.name,
        owner:
          widget.settings.mark === 'ours'
            ? widget.code === 'rkrs_colors' || widget.code === 'rkrs_dadata'
              ? 'Наш (старый сервер)'
              : 'Наш новый'
            : widget.settings.mark === 'partner'
              ? 'Партнёрка'
              : 'Сторонний',
        firstSeen: widget.firstSeen,
        gone: widget.removed.includes(accountId),
      })),
    ...(clients.some(({ id }) => id === client.id)
      ? [
          {
            code: 'demo_old_export',
            name: 'Экспорт сделок',
            owner: 'Наш (старый сервер)',
            firstSeen: '2026-09-11',
            gone: true,
          },
        ]
      : []),
  ]
  const events: DemoEvent[] = [
    ...installs.map(
      (install): DemoEvent => ({
        id: install.id,
        date: install.date ?? '',
        kind: 'install',
        title: 'Установлен виджет',
        widget: cellText(install.cells[1]),
        details: `Из amoМаркета · ${cellText(install.installer)} · ${cellText(install.cells[5])}`,
        actor: 'amoCRM',
      }),
    ),
    ...invoices.map(
      (invoice): DemoEvent => ({
        id: invoice.id,
        date: '2026-11-15',
        kind: 'payment',
        title: 'Выставлен счёт',
        widget: '—',
        details: `${cellText(invoice.cells[0])} · ${cellText(invoice.cells[2])}`,
        actor: 'Менеджер',
      }),
    ),
    {
      id: 'edit-status',
      date: '2026-11-12',
      kind: 'edit' as const,
      title: 'Обновлён статус клиента',
      widget: '—',
      details: client.owner,
      actor: 'Менеджер',
    },
  ].sort((left, right) => right.date.localeCompare(left.date))
  return { users, seen, events }
}

export function formatDate(value: string) {
  return value ? dateLabel(value) : '—'
}
