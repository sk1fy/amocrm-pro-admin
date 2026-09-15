import { useState } from 'react'
import type { BackendRegistryEntry } from '../../api/types'
import { CopyableId } from '../../components/CopyableId'
import { DataTable } from '../../components/DataTable'
import { DetailDrawer } from '../../components/DetailDrawer'
import { StatusBadge } from '../../components/StatusBadge'
import { formatNull, formatTime } from '../../lib/format'
import styles from './BackendRegistry.module.css'

function JsonViewer({ value, label }: { value: unknown; label: string }) {
  const [copied, setCopied] = useState(false)
  const text = JSON.stringify(value, null, 2)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className={styles.json}>
      <div className={styles.jsonHead}>
        <span>{label}</span>
        <button type="button" onClick={() => void copy()}>
          Копировать JSON
        </button>
        <span className={styles.jsonStatus} role="status" aria-live="polite">
          {copied ? 'JSON скопирован' : ''}
        </span>
      </div>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  )
}

function CapabilityList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) {
    return <p className={styles.muted}>{empty}</p>
  }
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

function BackendDetail({ entry }: { entry: BackendRegistryEntry }) {
  return (
    <div className={styles.detail}>
      <p>
        {formatNull(entry.display_name)} <span className={styles.code}>{entry.backend}</span>
      </p>
      <dl>
        <dt>Тип адаптера</dt>
        <dd>{formatNull(entry.kind)}</dd>
        <dt>Контракт</dt>
        <dd>{formatNull(entry.contract_version)}</dd>
        <dt>Ревизия</dt>
        <dd>
          {entry.revision ? (
            <CopyableId value={entry.revision} label="ревизии" />
          ) : (
            formatNull(null)
          )}
        </dd>
        <dt>Последний ответ</dt>
        <dd>
          <time dateTime={entry.observed_at ?? undefined} title={entry.observed_at ?? undefined}>
            {formatTime(entry.observed_at)}
          </time>
        </dd>
      </dl>
      <section>
        <h3>Возможности адаптера</h3>
        <CapabilityList items={entry.adapter_capabilities} empty={formatNull(null)} />
      </section>
      <section>
        <h3>Возможности бекенда</h3>
        <CapabilityList items={entry.backend_capabilities} empty={formatNull(null)} />
      </section>
      <section>
        <h3>Продукты</h3>
        {entry.products.length > 0 ? (
          <ul className={styles.list}>
            {entry.products.map((product) => (
              <li key={product.code}>
                {product.code} — {product.display_name}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>{formatNull(null)}</p>
        )}
      </section>
      {entry.components !== undefined && entry.components !== null ? (
        <JsonViewer value={entry.components} label="Компоненты" />
      ) : (
        <p className={styles.muted}>Компоненты: {formatNull(null)}</p>
      )}
    </div>
  )
}

export function BackendRegistry({ items }: { items: BackendRegistryEntry[] }) {
  const [selected, setSelected] = useState<BackendRegistryEntry | null>(null)
  return (
    <>
      <DataTable
        rows={items}
        rowKey={(entry) => entry.backend}
        onRowClick={(entry) => setSelected(entry)}
        columns={[
          {
            id: 'name',
            header: 'Бекенд',
            sortValue: (entry) => entry.display_name,
            cell: (entry) => (
              <span className={styles.name}>
                <span>{formatNull(entry.display_name)}</span>
                <span className={styles.code}>{entry.backend}</span>
              </span>
            ),
          },
          {
            id: 'type',
            header: 'Тип',
            nowrap: true,
            sortValue: (entry) => entry.kind,
            cell: (entry) => formatNull(entry.kind),
          },
          {
            id: 'status',
            header: 'Состояние',
            nowrap: true,
            sortValue: (entry) => entry.status,
            cell: (entry) => (
              <StatusBadge
                domain="source"
                state={entry.status}
                testId={`backend-status-${entry.backend}`}
              />
            ),
          },
          {
            id: 'contract',
            header: 'Контракт',
            nowrap: true,
            cell: (entry) => formatNull(entry.contract_version),
          },
          {
            id: 'checked',
            header: 'Последняя проверка',
            nowrap: true,
            sortValue: (entry) => entry.checked_at,
            cell: (entry) => (
              <time dateTime={entry.checked_at} title={entry.checked_at}>
                {formatTime(entry.checked_at)}
              </time>
            ),
          },
          {
            id: 'errors',
            header: 'Ошибки',
            ellipsis: true,
            title: (entry) => entry.error?.message ?? '',
            cell: (entry) =>
              entry.error ? (
                <>
                  {entry.error.message} <span className={styles.code}>({entry.error.code})</span>
                </>
              ) : (
                formatNull(null)
              ),
          },
        ]}
      />
      <DetailDrawer
        title={selected ? formatNull(selected.display_name) : 'Бекенд'}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
      >
        {selected ? <BackendDetail entry={selected} /> : null}
      </DetailDrawer>
    </>
  )
}
