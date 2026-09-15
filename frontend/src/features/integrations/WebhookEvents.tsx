import page from '../../components/page.module.css'
import { formatNull } from '../../lib/format'
import { groupWebhookEvents, webhookEventLabel } from '../../lib/labels'

function eventsCountLabel(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} событие`
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} события`
  }
  return `${count} событий`
}

export function WebhookEvents({ events }: { events: string[] }) {
  if (events.length === 0) {
    return formatNull(null)
  }
  const groups = groupWebhookEvents(events)
  return (
    <details className={page.expand}>
      <summary>{eventsCountLabel(events.length)}</summary>
      {groups.map((group) => (
        <div key={group.group}>
          <strong>{group.group}</strong>
          <ul>
            {group.items.map((code) => (
              <li key={code}>
                {webhookEventLabel(code)} <span className={page.muted}>{code}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </details>
  )
}
