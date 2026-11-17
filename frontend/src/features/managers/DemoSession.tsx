import { createContext, useContext, useState, type ReactNode } from 'react'
import { createRequestKey } from '../operations/intents'
import { boards, installs, dateLabel, type DemoRow } from './fixtures'
import { demoClients, findDemoClient } from './clientDirectory'
import type { DemoEvent } from './accountFixtures'
import { invoiceSnapshot, type InvoiceSeller, type InvoiceKind } from './invoiceFixtures'
import { snapshotBonuses, snapshotReceipts } from './paymentFixtures'
import type { Section } from './sections'

export type Block = 'clients' | 'pay' | 'partners' | 'admin'
export type Employee = {
  id: string
  name: string
  blocks: Block[]
  phone: string
  added: string
  demo?: true
}
export const initialStaff: Employee[] = [
  {
    id: 'max',
    name: 'Максим',
    blocks: ['admin'],
    phone: '+7 (921) 600-15-17',
    added: '2026-01-10',
  },
  {
    id: 'anna',
    name: 'Анна',
    blocks: ['clients'],
    phone: '+7 (921) 600-22-01',
    added: '2026-06-02',
    demo: true,
  },
  {
    id: 'olga',
    name: 'Ольга',
    blocks: ['pay'],
    phone: '+7 (921) 600-22-02',
    added: '2026-08-14',
    demo: true,
  },
  {
    id: 'irina',
    name: 'Ирина',
    blocks: ['clients', 'partners'],
    phone: '+7 (921) 600-22-03',
    added: '2026-10-01',
    demo: true,
  },
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
  kind?: InvoiceKind
  seller?: InvoiceSeller
  by?: string
  deal?: string
  paidAt?: string
  statementId?: string
  opened?: string
  method?: 'card' | 'invoice'
  payer?: string
  payerInn?: string
  downloads?: number
  legalEntities?: number
  cardUntil?: string
  legacy?: true
  snapshot?: true
}
export type StatementAttribution =
  | { client: string; partner?: never; by: string }
  | { partner: string; client?: never; by: string }
export type SessionEvent = DemoEvent & { client: string }
export type DemoState = {
  accounts: Record<string, AccountState>
  rows: DemoRow[]
  invoices: Invoice[]
  events: SessionEvent[]
  staff: Employee[]
  statementAttributions: Record<string, StatementAttribution>
}
export const today = '2026-11-16'
export const cellText = (cell: DemoRow['cells'][number]) =>
  typeof cell === 'string' ? cell : cell.text
export const money = (amount: number) => `${amount.toLocaleString('ru-RU')} ₽`
export function initialState(): DemoState {
  return {
    statementAttributions: {},
    accounts: Object.fromEntries(
      demoClients.map((client) => [
        client.id,
        {
          owner: client.owner,
          note: '',
          subscribed:
            client.owner === 'Наш клиент' && client.bucket !== 'expired' && !client.suspended,
          subscriptionTill: client.till,
          bonus: client.id === '91001001' ? 2400 : (snapshotBonuses.get(client.id)?.amount ?? 0),
          bonusUntil: snapshotBonuses.get(client.id)?.next || '2026-12-01',
          bonusHistory: [],
          companies: [],
        },
      ]),
    ),
    rows: [...installs],
    events: [],
    staff: initialStaff,
    invoices: [
      ...invoiceSnapshot,
      ...boards.invoices.rows.map(
        (row): Invoice => ({
          id: row.id,
          legacy: true,
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
        }),
      ),
    ],
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
function staffPhoneKey(phone: string) {
  return phone.replace(/\D/g, '').replace(/^[78](?=\d{10}$)/, '')
}

export function staffDraftError(staff: readonly Employee[], name: string, phone: string) {
  if (!name.trim()) return 'Укажите имя сотрудника.'
  if (!/^\+?[\d ()-]+$/.test(phone) || !/^\d{7,15}$/.test(staffPhoneKey(phone))) {
    return 'Введите действительный номер телефона.'
  }
  if (staff.some((entry) => staffPhoneKey(entry.phone) === staffPhoneKey(phone))) {
    return 'Сотрудник с таким телефоном уже есть.'
  }
  return ''
}

export type Action =
  | { type: 'account'; client: string; patch: Partial<AccountState>; block: Block; title: string }
  | { type: 'install'; id: string; patch: Partial<DemoRow>; title: string }
  | { type: 'renew'; id: string; until: string; reason: string; detail: string; bonus: number }
  | { type: 'invoice'; invoice: Invoice }
  | { type: 'settle' | 'cancel'; id: string }
  | { type: 'reconcileReceipt'; id: string; statementId: string }
  | {
      type: 'identifyReceipt'
      statementId: string
      target: { client: string } | { partner: string }
    }
  | { type: 'staff'; id: string; blocks: Block[] }
  | { type: 'addStaff'; id: string; name: string; phone: string; block: Exclude<Block, 'admin'> }
  | { type: 'removeStaff'; id: string }

export function transition(state: DemoState, actor: Employee, action: Action): DemoState {
  const block =
    action.type === 'account'
      ? action.block
      : action.type === 'install'
        ? 'clients'
        : action.type === 'staff' || action.type === 'addStaff' || action.type === 'removeStaff'
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
        id: createRequestKey(),
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
  if (action.type === 'addStaff') {
    const name = action.name.trim()
    const phone = action.phone.trim()
    if (staffDraftError(state.staff, name, phone) || state.staff.some((s) => s.id === action.id)) {
      return state
    }
    return {
      ...state,
      staff: [...state.staff, { id: action.id, name, phone, blocks: [action.block], added: today }],
    }
  }
  if (action.type === 'staff' || action.type === 'removeStaff') {
    const employee = state.staff.find((s) => s.id === action.id)
    if (!employee) return state
    const lastAdmin =
      employee.blocks.includes('admin') &&
      state.staff.filter((s) => s.blocks.includes('admin')).length === 1
    if (action.type === 'removeStaff') {
      if (lastAdmin || employee.id === actor.id) return state
      return { ...state, staff: state.staff.filter((s) => s.id !== employee.id) }
    }
    if (lastAdmin && !action.blocks.includes('admin')) return state
    const staff = state.staff.map((s) =>
      s.id === employee.id ? { ...s, blocks: action.blocks } : s,
    )
    return { ...state, staff }
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
  const statement =
    action.type === 'identifyReceipt' || action.type === 'reconcileReceipt'
      ? snapshotReceipts.find(
          (record) => record.id === action.statementId && record.state === 'unmatched',
        )
      : undefined
  if (action.type === 'identifyReceipt' || action.type === 'reconcileReceipt') {
    if (
      !statement ||
      state.statementAttributions[statement.id] ||
      state.invoices.some((item) => item.statementId === statement.id)
    )
      return state
  }
  if (action.type === 'identifyReceipt') {
    if (!statement) return state
    if ('client' in action.target && !state.accounts[action.target.client]) return state
    if ('partner' in action.target && !action.target.partner.trim()) return state
    const next = {
      ...state,
      statementAttributions: {
        ...state.statementAttributions,
        [action.statementId]: { ...action.target, by: actor.name },
      },
    }
    return 'client' in action.target
      ? log(next, action.target.client, 'Поступление разобрано', money(statement.amount), 'payment')
      : next
  }
  const invoice = state.invoices.find((v) => v.id === action.id)
  if (!invoice || invoice.state !== 'open') return state
  if (statement && Math.round((invoice.amount - invoice.bonus) * 100) !== statement.amount * 100)
    return state
  const paid = action.type !== 'cancel'
  const paidAt = statement?.date ?? today
  const receipt = `${paid ? 'Оплата' : 'Отмена'} ${invoice.id} · ${actor.name} · ${dateLabel(paidAt)} · деньги: ${money(paid ? invoice.amount - invoice.bonus : 0)} · бонусы: ${money(invoice.bonus)}`
  let next = {
    ...state,
    invoices: state.invoices.map((v) =>
      v.id === invoice.id
        ? {
            ...v,
            state: paid ? ('paid' as const) : ('cancelled' as const),
            paidAt: paid ? paidAt : undefined,
            statementId: statement?.id,
            method: statement?.method ?? (paid ? (v.method ?? 'invoice') : v.method),
            receipt,
          }
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
      findDemoClient(v.client)?.name ?? '—',
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
