import { useState, type FormEvent } from 'react'
import { useDemo, can, type Company } from './DemoSession'
import { Renewal, InvoiceForm, InvoiceActions } from './Finance'
import { DataTable, type DataTableColumn } from '../../components/DataTable'
import { Filters, Panel, Table } from './AccountPanel'
import { CellValue } from './CellValue'
import {
  formatDate,
  type DemoClient,
  type DemoEvent,
  type DemoUser,
  type SeenWidget,
} from './accountFixtures'
import { type DemoRow } from './fixtures'
import styles from './AccountPanels.module.css'

const contactRoles = ['Неизвестно', 'Технический специалист', 'Собственник', 'ЛПР']

function ContactEditor({ row }: { row: DemoRow }) {
  const { actor, dispatch } = useDemo()
  const contact = row.cells[4]
  const phone = typeof contact === 'object' && contact.text !== '—' ? contact.text : ''
  const name = phone && typeof contact === 'object' ? contact.note?.split(' · ')[0] : ''
  const change = (field: 'phone' | 'name' | 'role', value: string) => {
    const previous = typeof contact === 'object' ? contact : { text: '' }
    const cells = [...row.cells]
    cells[4] = {
      ...previous,
      text: field === 'phone' ? value : previous.text,
      note: field === 'name' ? value : previous.note,
      detail: field === 'role' ? value : previous.detail,
    }
    dispatch({ type: 'install', id: row.id, patch: { cells }, title: 'Контакт установки изменён' })
  }
  return (
    <div className={styles.contact}>
      <input
        type="tel"
        aria-label={`Телефон, ${row.id}`}
        placeholder="Телефон не указан"
        value={phone}
        disabled={!can(actor, 'clients')}
        onChange={(e) => change('phone', e.target.value)}
      />
      <input
        aria-label={`Имя, ${row.id}`}
        placeholder="Имя не указано"
        value={name ?? ''}
        disabled={!can(actor, 'clients')}
        onChange={(e) => change('name', e.target.value)}
      />
      <select
        aria-label={`Роль, ${row.id}`}
        disabled={!can(actor, 'clients')}
        value={typeof contact === 'object' ? (contact.detail ?? 'Неизвестно') : 'Неизвестно'}
        onChange={(e) => change('role', e.target.value)}
      >
        {contactRoles.map((role) => (
          <option key={role}>{role}</option>
        ))}
      </select>
    </div>
  )
}

export function OurWidgets({
  rows,
  check,
}: {
  rows: readonly DemoRow[]
  check: (id: string, checked: boolean) => void
}) {
  const { actor, dispatch } = useDemo()
  const [renewing, setRenewing] = useState<string | null>(null)
  const columns: DataTableColumn<DemoRow>[] = [
    {
      id: 'status',
      header: 'Статус · установлен',
      cell: (row) => <CellValue value={row.installationStatus ?? '—'} />,
    },
    { id: 'widget', header: 'Виджет', cell: (row) => <CellValue value={row.cells[1]} /> },
    {
      id: 'paidUntil',
      header: 'Оплачен до',
      cell: (row) => <CellValue value={row.paidUntil ?? '—'} />,
    },
    {
      id: 'installer',
      header: 'Установил',
      cell: (row) => <CellValue value={row.installer ?? '—'} />,
    },
    { id: 'deal', header: 'Сделка', cell: (row) => <CellValue value={row.cells[5]} /> },
    {
      id: 'contact',
      header: 'Контакт из формы активации',
      cell: (row) => <ContactEditor row={row} />,
    },
    {
      id: 'actions',
      header: 'Действия',
      cell: (row) => (
        <div className={styles.widgetActions}>
          <button
            type="button"
            disabled={!can(actor, 'clients')}
            onClick={() => check(row.id, row.group !== 'Проверенные')}
          >
            {row.group === 'Проверенные' ? 'Вернуть' : 'Проверен'}
          </button>
          {typeof row.cells[1] === 'object' && row.cells[1].line === 'TOP' ? (
            <>
              <button
                type="button"
                data-variant="primary"
                disabled={!can(actor, 'pay')}
                aria-expanded={renewing === row.id}
                onClick={() => setRenewing((current) => (current === row.id ? null : row.id))}
              >
                Продлить
              </button>
              {renewing === row.id ? <Renewal row={row} close={() => setRenewing(null)} /> : null}
            </>
          ) : null}
          <label>
            <input
              type="checkbox"
              disabled={!can(actor, 'clients')}
              checked={row.reviewed ?? false}
              onChange={(e) =>
                dispatch({
                  type: 'install',
                  id: row.id,
                  patch: { reviewed: e.target.checked },
                  title: 'Отметка отзыва изменена',
                })
              }
            />{' '}
            Отзыв
          </label>
        </div>
      ),
    },
  ]
  return (
    <Panel
      title="Наши виджеты"
      hint="Телефон, имя, роль и отметка отзыва редактируются в демо-карточке."
    >
      {rows.length ? (
        <div className={styles.table}>
          <DataTable columns={columns} rows={[...rows]} rowKey={(row) => row.id} />
        </div>
      ) : (
        <p className={styles.empty}>Установок наших виджетов пока нет.</p>
      )}
    </Panel>
  )
}

const historyFilters = [
  { label: 'Всё' },
  { label: 'Установки', kind: 'install' },
  { label: 'Продления и подписка', kind: 'payment' },
  { label: 'Правки', kind: 'edit' },
] as const

function includesQuery(values: readonly string[], query: string) {
  const normalized = query.trim().toLocaleLowerCase('ru')
  return !normalized || values.join(' ').toLocaleLowerCase('ru').includes(normalized)
}

export function History({ events }: { events: readonly DemoEvent[] }) {
  const [active, setActive] = useState('Всё')
  const [query, setQuery] = useState('')
  const selected = historyFilters.find((item) => item.label === active)
  const kind = selected && 'kind' in selected ? selected.kind : undefined
  const rows = events.filter(
    (event) =>
      (!kind || event.kind === kind) &&
      includesQuery([event.title, event.details, event.widget], query),
  )
  return (
    <Panel title="История" hint="Установки, оплаты и правки по аккаунту.">
      <Filters
        active={active}
        change={setActive}
        filters={historyFilters.map((item) => ({
          label: item.label,
          count:
            'kind' in item
              ? events.filter((event) => event.kind === item.kind).length
              : events.length,
        }))}
      >
        <input
          type="search"
          aria-label="Поиск по истории"
          placeholder="Сделка, партнёр, комментарий"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </Filters>
      <Table
        columns={['Дата', 'Событие', 'Виджет', 'Подробности', 'Кто']}
        rows={rows.map((row) => ({
          id: row.id,
          cells: [
            formatDate(row.date),
            {
              text: row.title,
              tone: row.kind === 'install' ? 'blue' : row.kind === 'payment' ? 'green' : 'gray',
            },
            row.widget,
            row.details,
            row.actor,
          ],
        }))}
      />
    </Panel>
  )
}

export function Companies({
  invoices,
  client,
}: {
  invoices: readonly DemoRow[]
  client: DemoClient
}) {
  const { state, actor, dispatch } = useDemo()
  const companies = state.accounts[client.id].companies
  const [problem, setProblem] = useState('')
  const [invoiceDraftOpen, setInvoiceDraftOpen] = useState(false)
  function addCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const company: Company = {
      name: String(values.get('name') ?? '').trim(),
      inn: String(values.get('inn') ?? '').trim(),
      kpp: String(values.get('kpp') ?? '').trim(),
      address: String(values.get('address') ?? '').trim(),
      email: String(values.get('email') ?? '').trim(),
    }
    if (!company.name || companies.some(({ inn }) => inn === company.inn)) {
      setProblem(company.name ? 'Компания с этим ИНН уже есть.' : 'Укажите название компании.')
      return
    }
    dispatch({
      type: 'account',
      client: client.id,
      block: 'pay',
      title: 'Компания добавлена',
      patch: { companies: [...companies, company] },
    })
    setProblem('')
    form.reset()
  }

  return (
    <div className={styles.stack}>
      <Panel
        title="Счета клиента"
        hint={client.name}
        action={
          <button
            type="button"
            data-variant="primary"
            disabled={!can(actor, 'pay')}
            aria-expanded={invoiceDraftOpen}
            onClick={() => setInvoiceDraftOpen((open) => !open)}
          >
            + Выставить счёт
          </button>
        }
      >
        {invoices.length ? (
          <Table
            columns={['Счёт', 'За что', 'Сумма', 'Клиент выбрал', 'Статус']}
            rows={[
              ...invoices.map((invoice) => ({
                id: invoice.id,
                cells: [invoice.cells[0], ...invoice.cells.slice(2)],
              })),
            ]}
          />
        ) : (
          <p className={styles.empty}>Счетов ещё не было.</p>
        )}
        <div className={styles.chips}>
          {invoices.map((invoice) => (
            <span key={invoice.id}>
              {invoice.id} <InvoiceActions id={invoice.id} />
            </span>
          ))}
        </div>
        {invoiceDraftOpen ? (
          <InvoiceForm client={client.id} close={() => setInvoiceDraftOpen(false)} />
        ) : null}
      </Panel>
      <Panel
        title="Компании"
        hint="Реквизиты для счетов. В одном аккаунте может быть несколько юрлиц."
      >
        {companies.length ? (
          <Table
            columns={['Название', 'ИНН', 'КПП', 'Адрес', 'Почта для счетов']}
            rows={companies.map((company) => ({
              id: company.inn,
              cells: [
                company.name,
                company.inn,
                company.kpp || '—',
                company.address || '—',
                company.email || '—',
              ],
            }))}
          />
        ) : (
          <p className={styles.empty}>
            Компаний пока нет. Добавьте реквизиты, когда клиент попросит счёт.
          </p>
        )}
        <form className={styles.companyForm} onSubmit={addCompany}>
          <fieldset disabled={!can(actor, 'pay')}>
            <label>
              ИНН
              <input
                name="inn"
                inputMode="numeric"
                pattern="[0-9]{10}|[0-9]{12}"
                placeholder="10 или 12 цифр"
                required
              />
            </label>
            <label>
              Название
              <input name="name" placeholder="ООО «…»" required />
            </label>
            <label>
              КПП
              <input name="kpp" inputMode="numeric" pattern="[0-9]{9}" placeholder="Для ООО" />
            </label>
            <label>
              Адрес
              <input name="address" placeholder="Юридический адрес" />
            </label>
            <label>
              Почта для счетов
              <input name="email" type="email" placeholder="buh@example.invalid" />
            </label>
            <button type="submit" data-variant="primary">
              Добавить компанию
            </button>
            {problem ? (
              <p role="alert" className={styles.formError}>
                {problem}
              </p>
            ) : null}
          </fieldset>
        </form>
      </Panel>
    </div>
  )
}

const userFilters = {
  Все: () => true,
  Активные: (user: DemoUser) => user.active,
  Деактивированные: (user: DemoUser) => !user.active,
  Администраторы: (user: DemoUser) => user.admin,
  'С телефоном': (user: DemoUser) => !!user.phone,
}

export function Users({ users }: { users: readonly DemoUser[] }) {
  const [active, setActive] = useState('Все')
  const [query, setQuery] = useState('')
  const filters = Object.entries(userFilters)
  const predicate = filters.find(([label]) => label === active)?.[1] ?? userFilters.Все
  const rows = users.filter(
    (user) =>
      predicate(user) &&
      (includesQuery([user.name, user.email, user.phone], query) ||
        (query.replace(/\D/g, '').length >= 3 &&
          /^[+()\d\s-]+$/.test(query) &&
          user.phone.replace(/\D/g, '').includes(query.replace(/\D/g, '')))),
  )
  return (
    <Panel
      title="Пользователи amoCRM"
      hint="Справочник пользователей аккаунта. Телефон виден, если указан в профиле."
    >
      <Filters
        active={active}
        change={setActive}
        filters={filters.map(([label, accepts]) => ({
          label,
          count: users.filter(accepts).length,
        }))}
      >
        <input
          type="search"
          aria-label="Поиск пользователя"
          placeholder="Имя, почта, телефон"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </Filters>
      <Table
        columns={['Имя', 'ID', 'Группа', 'Почта', 'Телефон', 'Права', 'Статус', 'Добавлен']}
        rows={rows.map((user) => ({
          id: user.id,
          cells: [
            user.name,
            user.id,
            user.team,
            user.email,
            user.phone || '—',
            user.admin ? 'Администратор' : 'Пользователь',
            {
              text: user.active ? 'Активен' : 'Деактивирован',
              tone: user.active ? 'green' : 'gray',
            },
            formatDate(user.added),
          ],
        }))}
      />
    </Panel>
  )
}

export function SeenWidgets({ widgets }: { widgets: readonly SeenWidget[] }) {
  const [active, setActive] = useState('Все')
  const rows = widgets.filter(
    (widget) => active === 'Все' || widget.gone === (active === 'Пропали'),
  )
  return (
    <Panel title="Установленные виджеты" hint="Наши и сторонние виджеты, замеченные в аккаунте.">
      <Filters
        active={active}
        change={setActive}
        filters={['Все', 'Стоят сейчас', 'Пропали'].map((label) => ({ label }))}
      />
      <Table
        columns={['Виджет', 'Код', 'Чей', 'Впервые увидели', 'Сейчас']}
        rows={rows.map((widget) => ({
          id: widget.code,
          cells: [
            widget.name,
            widget.code,
            { text: widget.owner, tone: widget.owner === 'Сторонний' ? 'gray' : 'blue' },
            formatDate(widget.firstSeen),
            { text: widget.gone ? 'Пропал' : 'Стоит', tone: widget.gone ? 'gray' : 'green' },
          ],
        }))}
      />
    </Panel>
  )
}
