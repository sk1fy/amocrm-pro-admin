import { useState, type ReactNode } from 'react'
import type { CatalogBackend } from '../../api/types'
import { FilterBar, FilterField, type FilterChip } from '../../components/FilterBar'
import { lookupState } from '../../states'
import { Segmented, type SegmentOption } from '../../components/Segmented'

export const jobStatuses = [
  'queued',
  'processing',
  'retry',
  'completed',
  'failed',
  'dead',
  'cancelled',
]

const quickStatuses: SegmentOption[] = [
  { label: 'Все', value: undefined },
  { label: 'Ошибки', value: 'failed' },
  { label: 'В очереди', value: 'queued' },
]

/** A status the quick switch can show; any other one opens «Ещё фильтры». */
function quickStatus(status?: string): boolean {
  return quickStatuses.some((option) => option.value === status)
}

export type JobFilterValues = {
  status?: string
  type?: string
  backend?: string
}

/**
 * One compact row of job filters (ADR-0021): quick status and type. The
 * full status list and the backend of the global list are under «Ещё фильтры».
 * Page size lives in the table pager.
 */
export function JobFilters({
  values,
  onChange,
  onReset,
  backends,
  aside,
}: {
  values: JobFilterValues
  onChange: (patch: JobFilterValues) => void
  onReset: () => void
  backends?: CatalogBackend[]
  aside?: ReactNode
}) {
  const [typeDraft, setTypeDraft] = useState(values.type ?? '')
  const chips: FilterChip[] = []
  if (values.status) {
    chips.push({ id: 'status', label: 'Статус', value: lookupState('job', values.status).label })
  }
  if (values.type) {
    chips.push({ id: 'type', label: 'Тип', value: values.type })
  }
  if (values.backend) {
    const backend = backends?.find((item) => item.code === values.backend)
    chips.push({ id: 'backend', label: 'Бекенд', value: backend?.display_name ?? values.backend })
  }
  const showBackends = backends !== undefined && (backends.length > 1 || Boolean(values.backend))
  return (
    <FilterBar
      chips={chips}
      onRemoveChip={(id) => {
        if (id === 'type') {
          setTypeDraft('')
        }
        onChange({ [id]: undefined })
      }}
      onReset={() => {
        setTypeDraft('')
        onReset()
      }}
      onSubmit={(event) => {
        event.preventDefault()
        onChange({ type: typeDraft.trim() || undefined })
      }}
      aside={aside}
      moreOpen={Boolean(values.backend) || !quickStatus(values.status)}
      more={
        <>
          <FilterField label="Статус">
            <select
              value={values.status ?? ''}
              onChange={(event) => onChange({ status: event.target.value || undefined })}
            >
              <option value="">Все</option>
              {jobStatuses.map((status) => (
                <option key={status} value={status}>
                  {lookupState('job', status).label}
                </option>
              ))}
            </select>
          </FilterField>
          {showBackends ? (
            <FilterField label="Бекенд">
              <select
                value={values.backend ?? ''}
                onChange={(event) => onChange({ backend: event.target.value || undefined })}
              >
                <option value="">Все</option>
                {(backends ?? []).map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.display_name}
                  </option>
                ))}
              </select>
            </FilterField>
          ) : null}
        </>
      }
    >
      <Segmented
        label="Быстрый фильтр по статусу"
        options={quickStatuses}
        value={values.status}
        onChange={(status) => onChange({ status })}
      />
      <FilterField label="Тип задачи">
        <input
          value={typeDraft}
          onChange={(event) => setTypeDraft(event.target.value)}
          name="type"
          placeholder="например, webhook"
          title="Часть кода задачи, например webhook или activity"
        />
      </FilterField>
      <button type="submit">Найти</button>
    </FilterBar>
  )
}
