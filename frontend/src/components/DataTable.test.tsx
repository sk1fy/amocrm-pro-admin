import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DataTable, pagerRangeLabel } from './DataTable'

afterEach(cleanup)

type Row = {
  id: string
  name: string
}

const rows: Row[] = [
  { id: '1', name: 'первая' },
  { id: '2', name: 'вторая' },
]

const columns = [
  {
    id: 'name',
    header: 'Имя',
    cell: (row: Row) => row.name,
    sortValue: (row: Row) => Number(row.id),
  },
]

describe('DataTable', () => {
  it('renders rows without an expander by default', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />)
    expect(screen.queryByRole('button', { name: 'Подробнее' })).not.toBeInTheDocument()
    expect(screen.getByText('первая')).toBeInTheDocument()
  })

  it('toggles the detail row for the selected row only', () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        renderDetail={(row) => <span>детали {row.name}</span>}
      />,
    )
    const buttons = screen.getAllByRole('button', { name: 'Подробнее' })
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(buttons[0])
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'true')
    expect(buttons[1]).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('детали первая')).toBeInTheDocument()
    expect(screen.queryByText('детали вторая')).not.toBeInTheDocument()
    fireEvent.click(buttons[0])
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('детали первая')).not.toBeInTheDocument()
  })

  it('sorts rows from the header and keeps the original order as a toggle', () => {
    const { container } = render(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />,
    )
    const table = within(container)
    fireEvent.click(table.getByRole('button', { name: 'Сортировать: Имя' }))
    const body = table.getAllByRole('row').slice(1)
    expect(body[0]).toHaveTextContent('первая')
    expect(body[1]).toHaveTextContent('вторая')
    fireEvent.click(table.getByRole('button', { name: 'Сортировать: Имя' }))
    const resorted = table.getAllByRole('row').slice(1)
    expect(resorted[0]).toHaveTextContent('вторая')
  })

  it('invokes onRowClick from keyboard on the row', () => {
    const clicks: string[] = []
    const { container } = render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        onRowClick={(row) => clicks.push(row.id)}
      />,
    )
    const row = within(container).getByText('первая').closest('tr')
    expect(row).not.toBeNull()
    fireEvent.keyDown(row as HTMLTableRowElement, { key: 'Enter' })
    expect(clicks).toEqual(['1'])
  })

  it('shows a pager range and disables reset on the first page', () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        nextCursor="next"
        onNext={() => undefined}
        onReset={() => undefined}
        resetDisabled
        total={146}
      />,
    )
    expect(screen.getByText('1–2 из 146')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'В начало' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Дальше' })).toBeEnabled()
  })

  it('renders a dash when total is null', () => {
    expect(pagerRangeLabel(25, null)).toBe('1–25 из —')
    expect(pagerRangeLabel(25, 0)).toBe('1–25 из 0')
    expect(pagerRangeLabel(25)).toBe('1–25')
  })
})
