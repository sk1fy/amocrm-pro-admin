import type { Product } from './productsApi'
import styles from './WidgetSettings.module.css'

type DraftOption = { name: string; months: string; price: string; per_user: boolean }
type Option = Product['tariff_options'][number]

export function tariffDraft(options: Option[]) {
  return JSON.stringify(
    options.map(({ name, months, price_kopecks, per_user }) => ({
      name,
      months: String(months),
      price: String(price_kopecks / 100),
      per_user,
    })),
  )
}

function rowsOf(draft: string): DraftOption[] {
  return JSON.parse(draft) as DraftOption[]
}

export function tariffOptions(draft: string): Option[] | null {
  const options: Option[] = []
  for (const row of rowsOf(draft)) {
    const amount = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(row.price.trim())
    const months = Number(row.months)
    if (!amount || !row.name.trim() || !Number.isInteger(months) || months < 1 || months > 1200)
      return null
    const price = Number(amount[1]) * 100 + Number((amount[2] ?? '').padEnd(2, '0'))
    if (!Number.isSafeInteger(price) || price > 999999999999) return null
    options.push({ name: row.name.trim(), months, price_kopecks: price, per_user: row.per_user })
  }
  return options
}

export function ProductTariffs({
  draft,
  onChange,
  editable,
}: {
  draft: string
  onChange: (value: string) => void
  editable: boolean
}) {
  const rows = rowsOf(draft)
  const update = (index: number, patch: Partial<DraftOption>) =>
    onChange(JSON.stringify(rows.map((row, i) => (i === index ? { ...row, ...patch } : row))))
  return (
    <>
      {rows.map((row, index) => (
        <div
          className={styles.tariffRow}
          key={index}
          role="group"
          aria-label={'Тариф ' + (index + 1)}
        >
          <label>
            Название
            <input
              aria-label="Название тарифа"
              required
              maxLength={200}
              value={row.name}
              onChange={(e) => update(index, { name: e.target.value })}
            />
          </label>
          <label>
            Срок, мес
            <input
              type="number"
              required
              min={1}
              max={1200}
              step={1}
              value={row.months}
              onChange={(e) => update(index, { months: e.target.value })}
            />
          </label>
          <label>
            Цена, ₽
            <input
              inputMode="decimal"
              required
              value={row.price}
              onChange={(e) => update(index, { price: e.target.value })}
            />
          </label>
          <label className={styles.perUser}>
            <input
              type="checkbox"
              checked={row.per_user}
              onChange={(e) => update(index, { per_user: e.target.checked })}
            />
            за польз.
          </label>
          {editable && (
            <button
              type="button"
              className={styles.removeTariff}
              aria-label={'Удалить тариф ' + (index + 1)}
              onClick={() => onChange(JSON.stringify(rows.filter((_, i) => i !== index)))}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {!rows.length && !editable && <p>Тарифы не заданы.</p>}
      {editable && (
        <button
          type="button"
          className={styles.addTariff}
          disabled={rows.length >= 50}
          onClick={() =>
            onChange(
              JSON.stringify([...rows, { name: '', months: '12', price: '', per_user: false }]),
            )
          }
        >
          + Добавить тариф
        </button>
      )}
    </>
  )
}
