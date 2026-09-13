import type { BackendRegistryEntry } from '../../api/types'
import { StatusBadge } from '../../components/StatusBadge'
import { formatNull, formatTime } from '../../lib/format'
import styles from './BackendRegistry.module.css'

export function BackendRegistry({ items }: { items: BackendRegistryEntry[] }) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <caption>Реестр бекендов</caption>
        <thead>
          <tr>
            <th scope="col">Бекенд</th>
            <th scope="col">Тип адаптера</th>
            <th scope="col">Состояние</th>
            <th scope="col">Контракт</th>
            <th scope="col">Ревизия</th>
            <th scope="col">Возможности адаптера</th>
            <th scope="col">Продукты</th>
            <th scope="col">Возможности бекенда</th>
            <th scope="col">Компоненты</th>
            <th scope="col">Последний ответ</th>
            <th scope="col">Последняя проверка</th>
            <th scope="col">Ошибка</th>
          </tr>
        </thead>
        <tbody>
          {items.map((entry) => (
            <tr key={entry.backend}>
              <th scope="row">
                <span className={styles.name}>
                  <span>{formatNull(entry.display_name)}</span>
                  <span className={styles.code}>{entry.backend}</span>
                </span>
              </th>
              <td>{formatNull(entry.kind)}</td>
              <td>
                <StatusBadge
                  domain="source"
                  state={entry.status}
                  testId={`backend-status-${entry.backend}`}
                />
              </td>
              <td>{formatNull(entry.contract_version)}</td>
              <td>{formatNull(entry.revision)}</td>
              <td>
                {entry.adapter_capabilities.length > 0
                  ? entry.adapter_capabilities.join(', ')
                  : formatNull(null)}
              </td>
              <td>
                {entry.products.length > 0 ? (
                  <ul className={styles.list}>
                    {entry.products.map((product) => (
                      <li key={product.code}>
                        {product.code} — {product.display_name}
                      </li>
                    ))}
                  </ul>
                ) : (
                  formatNull(null)
                )}
              </td>
              <td>
                {entry.backend_capabilities.length > 0
                  ? entry.backend_capabilities.join(', ')
                  : formatNull(null)}
              </td>
              <td>
                {entry.components ? (
                  <details className={styles.details}>
                    <summary className={styles.summary}>Показать JSON</summary>
                    <pre className={styles.pre}>{JSON.stringify(entry.components, null, 2)}</pre>
                  </details>
                ) : (
                  formatNull(null)
                )}
              </td>
              <td>
                <time
                  dateTime={entry.observed_at ?? undefined}
                  title={entry.observed_at ?? undefined}
                >
                  {formatTime(entry.observed_at)}
                </time>
              </td>
              <td>
                <time dateTime={entry.checked_at} title={entry.checked_at}>
                  {formatTime(entry.checked_at)}
                </time>
              </td>
              <td>
                {entry.error ? (
                  <>
                    {entry.error.message} <span className={styles.code}>({entry.error.code})</span>
                  </>
                ) : (
                  formatNull(null)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
