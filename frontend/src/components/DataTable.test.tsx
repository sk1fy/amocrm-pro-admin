import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataTable } from './DataTable'

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
})
