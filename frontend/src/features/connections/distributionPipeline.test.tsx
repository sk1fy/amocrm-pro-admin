import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DigitalPipelineDiagnostics } from './DistributionSection'

describe('Digital Pipeline diagnostics', () => {
  it('keeps missing source data distinct from an empty inbox', () => {
    const html = renderToStaticMarkup(<DigitalPipelineDiagnostics data={null} />)
    expect(html).toContain('Источник не предоставил данные')
    expect(html).not.toContain('Входящих событий Digital Pipeline пока нет')
  })
  it.each([0, 2])('shows the empty hint only for a confirmed empty inbox (%s)', (count) => {
    const html = renderToStaticMarkup(
      <DigitalPipelineDiagnostics
        data={{
          inbox: { states: [{ state: 'pending', count }], oldest_pending_at: null },
          triggers: { states: [], oldest_pending_at: null },
        }}
      />,
    )
    expect(html.includes('Входящих событий Digital Pipeline пока нет')).toBe(count === 0)
  })
})
