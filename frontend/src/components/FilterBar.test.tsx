import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FilterBar, FilterField } from './FilterBar'

afterEach(cleanup)

describe('FilterBar', () => {
  it('shows chips and reset only for active filters', () => {
    const removed: string[] = []
    let reset = false
    render(
      <FilterBar
        chips={[{ id: 'status', label: 'Статус', value: 'Ошибка' }]}
        onRemoveChip={(id) => removed.push(id)}
        onReset={() => {
          reset = true
        }}
        onSubmit={(event) => event.preventDefault()}
      >
        <FilterField label="Статус">
          <select defaultValue="failed">
            <option value="failed">Ошибка</option>
          </select>
        </FilterField>
      </FilterBar>,
    )
    expect(screen.getByText('Статус: Ошибка')).toBeInTheDocument()
    expect(screen.queryByText(/Списки применяются сразу/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Снять фильтр Статус' }))
    expect(removed).toEqual(['status'])
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }))
    expect(reset).toBe(true)
  })

  it('hides reset without active filters and folds secondary filters', () => {
    render(
      <FilterBar
        onReset={() => undefined}
        onSubmit={(event) => event.preventDefault()}
        more={
          <FilterField label="Происхождение">
            <select defaultValue="real">
              <option value="real">Реальные</option>
            </select>
          </FilterField>
        }
      >
        <FilterField label="Статус">
          <select defaultValue="">
            <option value="">Все</option>
          </select>
        </FilterField>
      </FilterBar>,
    )
    expect(screen.queryByRole('button', { name: 'Сбросить фильтры' })).not.toBeInTheDocument()
    expect(screen.getByText('Ещё фильтры')).toBeInTheDocument()
    expect(screen.getByText('Ещё фильтры').closest('details')).not.toHaveAttribute('open')
  })
})
