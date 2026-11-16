import { createContext, useContext, useState, type ReactNode } from 'react'
import { boards, clients, installs, dateLabel, type DemoRow } from './fixtures'
import type { DemoEvent } from './accountFixtures'
import type { Section } from './sections'

export type Block = 'clients' | 'pay' | 'partners' | 'admin'
export type Employee = { id: string; name: string; blocks: Block[] }
export const initialStaff: Employee[] = [
  { id: 'max', name: 'Максим', blocks: ['admin'] },
  { id: 'anna', name: 'Анна', blocks: ['clients'] },
  { id: 'olga', name: 'Ольга', blocks: ['pay'] },
  { id: 'irina', name: 'Ирина', blocks: ['clients', 'partners'] },
]
export const blockSections: Record<Block, readonly Section[]> = {
  clients: ['installs', 'clients', 'widgets', 'market'],
  pay: ['invoices', 'payments'],
  partners: ['partners'],
  admin: Object.keys(boards) as Section[],
}
export type Company = { name: string; inn: string; kpp: string; address: string; email: string }
export type AccountState = {
  owner: string
  note: string
  subscribed: boolean
  subscriptionTill: string
  bonus: number
  bonusUntil: string
  bonusHistory: number[]
  companies: Company[]
}
export type Invoice = {
  number?: string
  id: string
  client: string
  description: string
  amount: number
  bonus: number
  state: 'open' | 'paid' | 'cancelled'
  date: string
  installation?: string
  until?: string
  receipt?: string
}
export type SessionEvent = DemoEvent & { client: string }
export type DemoState = {
  accounts: Record<string, AccountState>
  rows: DemoRow[]
  invoices: Invoice[]
  events: SessionEvent[]
  staff: Employee[]
}
export const today = '2026-11-16'
export const cellText = (cell: DemoRow['cells'][number]) =>
  typeof cell === 'string' ? cell : cell.text
export const money = (amount: number) => `${amount.toLocaleString('ru-RU')} ₽`
export function initialState(): DemoState {
  return {
    accounts: Object.fromEntries(
      clients.map((client) => [
        client.id,
        {
          owner: client.owner,
          note: '',
          subscribed: client.owner === 'Наш клиент' && client.health !== 'Лицензия истекла',
          subscriptionTill: client.till,
          bonus: client.id === '91001001' ? 2400 : 0,
          bonusUntil: '2026-12-01',
          bonusHistory: [],
          companies: [],
        },
      ]),
    ),
    rows: [...installs],
    events: [],
    staff: initialStaff,
    invoices: boards.invoices.rows.map((row) => ({
      id: row.id,
      number: cellText(row.cells[0]),
      client: row.client!,
      description: cellText(row.cells[2]),
      amount: Number(cellText(row.cells[3]).replace(/\D/g, '')),
      bonus: 0,
      date:
        typeof row.cells[0] === 'object' && row.cells[0].note
          ? row.cells[0].note.split('.').reverse().join('-')
          : today,
      state:
        row.group === 'Оплачены' ? 'paid' : row.group === 'Аннулированы' ? 'cancelled' : 'open',
    })),
  }
}
export function can(employee: Employee, block: Block) {
  return employee.blocks.includes('admin') || employee.blocks.includes(block)
}
export function canView(employee: Employee, section: Section) {
  return (
    section === 'stats' ||
    section === 'feed' ||
    employee.blocks.some((block) => blockSections[block].includes(section))
  )
}
export type Action =
  | { type: 'account'; client: string; patch: Partial<AccountState>; block: Block; title: string }
  | { type: 'install'; id: string; patch: Partial<DemoRow>; title: string }
  | { type: 'renew'; id: string; until: string; reason: string; detail: string; bonus: number }
  | { type: 'invoice'; invoice: Invoice }
  | { type: 'settle' | 'cancel'; id: string }
  | { type: 'staff'; id: string; blocks: Block[] }

export function transition(state: DemoState, actor: Employee, action: Action): DemoState {
  const block =
    action.type === 'account'
      ? action.block
      : action.type === 'install'
        ? 'clients'
        : action.type === 'staff'
          ? 'admin'
          : 'pay'
  if (!can(actor, block)) return state
  const log = (
    next: DemoState,
    client: string,
    title: string,
    details: string,
    kind: DemoEvent['kind'] = 'edit',
  ) => ({
    ...next,
    events: [
      {
        id: crypto.randomUUID(),
        client,
        title,
        details,
        kind,
        date: today,
        widget: '—',
        actor: actor.name,
      },
      ...next.events,
    ],
  })
  if (action.type === 'staff') {
    if (
      !action.blocks.includes('admin') &&
      state.staff.find((s) => s.id === action.id)?.blocks.includes('admin') &&
      state.staff.filter((s) => s.blocks.includes('admin')).length === 1
    )
      return state
    return {
      ...state,
      staff: state.staff.map((s) => (s.id === action.id ? { ...s, blocks: action.blocks } : s)),
    }
  }
  if (action.type === 'account') {
    const account = state.accounts[action.client]
    if (
      !account ||
      (action.patch.bonus !== undefined &&
        (!Number.isSafeInteger(action.patch.bonus) || action.patch.bonus < 0))
    )
      return state
    return log(
      {
        ...state,
        accounts: { ...state.accounts, [action.client]: { ...account, ...action.patch } },
      },
      action.client,
      action.title,
      'Изменение в демо-сессии',
    )
  }
  if (action.type === 'install' || action.type === 'renew') {
    const row = state.rows.find((r) => r.id === action.id)
    if (!row?.client) return state
    if (action.type === 'install')
      return log(
        {
          ...state,
          rows: state.rows.map((r) => (r.id === row.id ? { ...r, ...action.patch } : r)),
        },
        row.client,
        action.title,
        actor.name,
      )
    const account = state.accounts[row.client]
    if (
      !action.until ||
      !/^\d{4}-\d{2}-\d{2}$/.test(action.until) ||
      !action.detail.trim() ||
      action.bonus < 0 ||
      action.bonus > account.bonus
    )
      return state
    return log(
      {
        ...state,
        rows: state.rows.map((r) =>
          r.id === row.id ? { ...r, paidUntil: dateLabel(action.until) } : r,
        ),
        accounts: {
          ...state.accounts,
          [row.client]: {
            ...account,
            bonus: account.bonus - action.bonus,
            bonusHistory: action.bonus
              ? [...account.bonusHistory, -action.bonus]
              : account.bonusHistory,
          },
        },
      },
      row.client,
      'Виджет продлён',
      `${cellText(row.cells[1])} до ${dateLabel(action.until)} · ${action.reason} · ${action.detail} · без поступления денег`,
      'payment',
    )
  }
  if (action.type === 'invoice') {
    const invoice = action.invoice
    const account = state.accounts[invoice.client]
    if (
      !account ||
      state.invoices.some((v) => v.id === invoice.id) ||
      !invoice.description.trim() ||
      !Number.isFinite(invoice.amount) ||
      invoice.amount <= 0 ||
      !Number.isSafeInteger(invoice.bonus) ||
      invoice.bonus < 0 ||
      (invoice.installation !== undefined &&
        (!state.rows.some((r) => r.id === invoice.installation && r.client === invoice.client) ||
          !invoice.until ||
          !/^\d{4}-\d{2}-\d{2}$/.test(invoice.until))) ||
      invoice.bonus > Math.min(account.bonus, invoice.amount)
    )
      return state
    return log(
      {
        ...state,
        invoices: [invoice, ...state.invoices],
        accounts: {
          ...state.accounts,
          [invoice.client]: { ...account, bonus: account.bonus - invoice.bonus },
        },
      },
      invoice.client,
      'Выставлен счёт',
      `${invoice.id} · ${money(invoice.amount)}; зарезервировано бонусов ${money(invoice.bonus)}`,
      'payment',
    )
  }
  const invoice = state.invoices.find((v) => v.id === action.id)
  if (!invoice || invoice.state !== 'open') return state
  const paid = action.type === 'settle'
  const receipt = `${paid ? 'Оплата' : 'Отмена'} ${invoice.id} · ${actor.name} · ${dateLabel(today)} · деньги: ${money(paid ? invoice.amount - invoice.bonus : 0)} · бонусы: ${money(invoice.bonus)}`
  let next = {
    ...state,
    invoices: state.invoices.map((v) =>
      v.id === invoice.id
        ? { ...v, state: paid ? ('paid' as const) : ('cancelled' as const), receipt }
        : v,
    ),
  }
  if (!paid)
    next = {
      ...next,
      accounts: {
        ...next.accounts,
        [invoice.client]: {
          ...next.accounts[invoice.client],
          bonus: next.accounts[invoice.client].bonus + invoice.bonus,
        },
      },
    }
  if (paid && invoice.installation && invoice.until)
    next = {
      ...next,
      rows: next.rows.map((r) =>
        r.id === invoice.installation ? { ...r, paidUntil: dateLabel(invoice.until!) } : r,
      ),
    }
  return log(next, invoice.client, paid ? 'Счёт оплачен' : 'Счёт аннулирован', receipt, 'payment')
}

const Context = createContext<{
  state: DemoState
  actor: Employee
  actorId: string
  invoiceFocus: string | null
  focusInvoice: (id: string | null) => void
  selectActor: (id: string) => void
  dispatch: (action: Action) => void
} | null>(null)
export function DemoSession({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialState)
  const [actorId, selectActor] = useState('max')
  const [invoiceFocus, focusInvoice] = useState<string | null>(null)
  const actor = state.staff.find((s) => s.id === actorId) ?? state.staff[0]
  return (
    <Context.Provider
      value={{
        state,
        actor,
        actorId,
        invoiceFocus,
        focusInvoice,
        selectActor,
        dispatch: (action) =>
          setState((s) =>
            transition(s, s.staff.find((a) => a.id === actorId) ?? s.staff[0], action),
          ),
      }}
    >
      {children}
    </Context.Provider>
  )
}
export function useDemo() {
  const value = useContext(Context)
  if (!value) throw new Error('DemoSession required')
  return value
}
export function invoiceRows(invoices: readonly Invoice[]): DemoRow[] {
  return invoices.map((v) => ({
    id: v.id,
    client: v.client,
    date: v.date,
    group:
      v.state === 'paid'
        ? 'Оплачены'
        : v.state === 'cancelled'
          ? 'Аннулированы'
          : Date.parse(today) - Date.parse(v.date) >= 5 * 86400000
            ? 'Без движения'
            : 'Ждём оплату',
    cells: [
      v.number ?? v.id,
      clients.find((c) => c.id === v.client)?.name ?? '—',
      v.description,
      money(v.amount),
      v.bonus ? `Бонусы ${money(v.bonus)}` : 'Банковский перевод',
      {
        text:
          v.state === 'paid' ? 'Оплачен' : v.state === 'cancelled' ? 'Аннулирован' : 'Ждём оплату',
        tone: v.state === 'paid' ? 'green' : 'gray',
      },
    ],
  }))
}
