import { useState, type ReactNode } from 'react'
import type { Bucket } from './statisticsData'
import styles from './StatsBoard.module.css'

export const statisticNumber = (value: number) => value.toLocaleString('ru-RU')

type RankRow = {
  key: string | number
  label: ReactNode
  value: number
  color?: string
  note?: string
}

export function RankChart({
  rows,
  format = statisticNumber,
}: {
  rows: readonly RankRow[]
  format?: (value: number) => string
}) {
  if (!rows.length) return <p className={styles.empty}>Нет данных за период.</p>
  const max = Math.max(1, ...rows.map(({ value }) => value))
  return (
    <ul className={styles.ranks}>
      {rows.map(({ key, label, value, color, note }, index) => (
        <li className={styles.rank} key={key}>
          <span className={styles.rankNumber}>{index + 1}</span>
          <span className={styles.rankLabel}>{label}</span>
          <span className={styles.rankTrack} aria-hidden="true">
            <span style={{ width: `${(value / max) * 100}%`, backgroundColor: color }} />
          </span>
          <strong>{format(value)}</strong>
          {note && <small className={styles.rankNote}>{note}</small>}
        </li>
      ))}
    </ul>
  )
}

type Series = { name: string; color: string }

function total(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0)
}

function axisMax(value: number) {
  if (value <= 4) return 4
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  return ([1, 2, 4, 5, 10].find((step) => step >= normalized) ?? 10) * magnitude
}

export function ColumnChart({
  label,
  buckets,
  series,
  column = 'Неделя',
  every = 1,
  format = statisticNumber,
  formatTick = format,
}: {
  label: string
  buckets: readonly Bucket[]
  series: readonly Series[]
  column?: string
  every?: number
  format?: (value: number) => string
  formatTick?: (value: number) => string
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [focused, setFocused] = useState<number | null>(null)
  const index = hovered ?? focused
  const active = index === null ? undefined : buckets[index]
  const multiple = series.length > 1
  const max = axisMax(Math.max(1, ...buckets.map(({ values }) => total(values))))

  function sampleLabel(bucket: Bucket) {
    const parts = multiple
      ? series.map(({ name }, index) => name + ' ' + format(bucket.values[index]))
      : []
    return [bucket.period, ...parts, format(total(bucket.values))].join(' · ')
  }

  return (
    <div className={styles.chart} data-dense={every > 1}>
      <div className={styles.plot} role="group" aria-label={label}>
        {[0, 50, 100].map((level) => (
          <span
            className={styles.tick}
            style={{ bottom: level + '%' }}
            key={level}
            aria-hidden="true"
          >
            <span>{formatTick((max * level) / 100)}</span>
          </span>
        ))}
        <div className={styles.columns} onMouseLeave={() => setHovered(null)}>
          {buckets.map((bucket, index) => (
            <button
              type="button"
              key={bucket.key}
              className={styles.column}
              aria-label={sampleLabel(bucket)}
              onMouseEnter={() => setHovered(index)}
              onFocus={() => setFocused(index)}
              onBlur={() => setFocused(null)}
              onClick={() => setFocused(index)}
            >
              {bucket.values.map((value, index) =>
                value > 0 ? (
                  <span
                    key={series[index].name}
                    style={{
                      height: `max(1px, calc(${(value / max) * 100}% - 2px))`,
                      backgroundColor: series[index].color,
                    }}
                  />
                ) : null,
              )}
            </button>
          ))}
        </div>
        {active && index !== null && (
          <div
            role="tooltip"
            className={styles.readout}
            style={{ left: `${((index + 0.5) / buckets.length) * 100}%` }}
            data-edge={
              index < buckets.length / 3
                ? 'left'
                : index > (buckets.length * 2) / 3
                  ? 'right'
                  : 'center'
            }
          >
            <strong>{active.period}</strong>
            {multiple &&
              series.map(({ name, color }, index) => (
                <span key={name}>
                  <i style={{ backgroundColor: color }} />
                  {name} · {format(active.values[index])}
                </span>
              ))}
            <span>
              {multiple ? 'Всего · ' : ''}
              {format(total(active.values))}
            </span>
          </div>
        )}
      </div>
      <div className={styles.axis} aria-hidden="true">
        {buckets.map(({ key, label }, index) => (
          <span data-mobile-hide={index % (every * 2) !== 0} key={key}>
            {index % every === 0 ? label : ''}
          </span>
        ))}
      </div>
      {multiple && (
        <ul className={styles.legend}>
          {series.map(({ name, color }) => (
            <li key={name}>
              <i style={{ backgroundColor: color }} />
              {name}
            </li>
          ))}
        </ul>
      )}
      <details className={styles.details}>
        <summary aria-label={`Таблица: ${label}`}>Таблица</summary>
        <div className={styles.tableScroll}>
          <table className={styles.table} aria-label={label}>
            <thead>
              <tr>
                <th scope="col">{column}</th>
                {series.map(({ name }) => (
                  <th scope="col" key={name}>
                    {name}
                  </th>
                ))}
                {multiple && <th scope="col">Всего</th>}
              </tr>
            </thead>
            <tbody>
              {buckets.map(({ key, period, values }) => (
                <tr key={key}>
                  <th scope="row">{period}</th>
                  {series.map(({ name }, index) => (
                    <td key={name}>{format(values[index])}</td>
                  ))}
                  {multiple && <td>{format(total(values))}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
