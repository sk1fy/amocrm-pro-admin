import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FilterBar, FilterField } from './FilterBar'

afterEach(cleanup)

describe('FilterBar', () => {
  it('shows the active filter count, chips and reset', () => {
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
    expect(screen.getByText('Активных фильтров: 1')).toBeInTheDocument()
    expect(screen.getByText('Статус: Ошибка')).toBeInTheDocument()
    expect(
      screen.getByText('Списки применяются сразу. Поиск — по кнопке «Найти».'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Снять фильтр Статус' }))
    expect(removed).toEqual(['status'])
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }))
    expect(reset).toBe(true)
  })

  it('disables reset when there are no chips', () => {
    render(
      <FilterBar onReset={() => undefined} onSubmit={(event) => event.preventDefault()}>
        <FilterField label="Статус">
          <select defaultValue="">
            <option value="">Все</option>
          </select>
        </FilterField>
      </FilterBar>,
    )
    expect(screen.getByText('Нет активных фильтров')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сбросить фильтры' })).toBeDisabled()
  })
})
