import type { Portrait } from './accountsApi'
import styles from './PortraitWidgetTiers.module.css'

function TierProgress({
  line,
  working,
  total,
}: {
  line: 'TOP' | 'PRO'
  working: number
  total: number
}) {
  const percent = total === 0 ? 0 : Math.round((100 * working) / total)
  return (
    <div className={styles.tier} data-tier={line}>
      <p className={styles.heading}>
        <span>{line} — работают</span>
        <strong>{total ? `${working} из ${total} · ${percent}%` : '0 · каталог пуст'}</strong>
      </p>
      <progress aria-label={line + ' с действующим доступом'} value={working} max={total || 1} />
      <small>Учитывается действующий доступ</small>
    </div>
  )
}

export function PortraitWidgetTiers({ tiers }: { tiers: Portrait['widget_tiers'] }) {
  if (!tiers) return null
  return (
    <section className={styles.summary} aria-label="Установки по линейкам виджетов">
      <div className={styles.tier} data-tier="FREE">
        <p className={styles.heading}>
          <span>FREE — стоят</span>
          <strong>{tiers.free_installed}</strong>
        </p>
        <progress
          aria-label="Установлен хотя бы один FREE"
          max={1}
          value={Math.min(tiers.free_installed, 1)}
        />
        <small>Цель — хотя бы один FREE виджет</small>
      </div>
      <TierProgress line="TOP" {...tiers.top} />
      <TierProgress line="PRO" {...tiers.pro} />
    </section>
  )
}
