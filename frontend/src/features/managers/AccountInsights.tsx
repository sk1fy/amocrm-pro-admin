import { useState } from 'react'
import { Panel, Table } from './AccountPanel'
import { formatDate, type DemoClient } from './accountFixtures'
import styles from './AccountPanels.module.css'

const funnelStages = [
  'Неразобранное',
  'Новая сделка',
  'Распределение',
  'Первый контакт',
  'Интерес подтверждён',
  'Ожидает решения',
  'Назначена встреча',
  'Успешно реализовано',
  'Закрыто и не реализовано',
]

const pipelineDeals = [
  { date: '2026-11-04', stage: 'Новая сделка', amount: 18000 },
  { date: '2026-11-06', stage: 'Первый контакт', amount: 24000 },
  { date: '2026-11-10', stage: 'Интерес подтверждён', amount: 16000 },
  { date: '2026-11-11', stage: 'Успешно реализовано', amount: 42000 },
  { date: '2026-11-14', stage: 'Закрыто и не реализовано', amount: 27000 },
  { date: '2026-11-19', stage: 'Успешно реализовано', amount: 33000 },
]

const money = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
})
const pipelineColumns = [
  'Этап',
  'Кол-во (созд.)',
  'Сумма (созд.)',
  'Кол-во (закр.)',
  'Сумма (закр.)',
]

export function Audit({ client, showPortrait }: { client: DemoClient; showPortrait: () => void }) {
  const [calls, setCalls] = useState(client.health === 'Получаем данные')
  const [duplicates, setDuplicates] = useState(false)
  const [range, setRange] = useState({ from: '2026-11-01', to: '2026-11-30' })
  const [period, setPeriod] = useState<typeof range | null>(null)
  const deals = period
    ? pipelineDeals.filter(({ date }) => date >= period.from && date <= period.to)
    : []
  const rows = funnelStages.map((stage) => {
    const atStage = deals.filter((deal) => deal.stage === stage)
    const sum = atStage.reduce((total, deal) => total + deal.amount, 0)
    const closed = stage === 'Успешно реализовано' || stage === 'Закрыто и не реализовано'
    return {
      id: stage,
      cells: [
        stage,
        period ? String(atStage.length) : '—',
        period ? money.format(sum) : '—',
        period ? String(closed ? atStage.length : 0) : '—',
        period ? money.format(closed ? sum : 0) : '—',
      ],
    }
  })

  return (
    <div className={styles.stack}>
      <Panel
        title="Аудит клиента"
        hint="Звонки, дубли контактов и воронки на демо-данных."
        action={
          <button type="button" data-variant="primary" onClick={() => setCalls(true)}>
            Собрать данные
          </button>
        }
      >
        <div className={styles.bordered}>
          <h3>Звонки</h3>
          {calls ? (
            <div className={styles.callsGrid}>
              <div className={styles.callMetric}>
                <small>В среднем за месяц</small>
                <strong>742 звонка</strong>
                <strong>1 039 минут</strong>
              </div>
              <Table
                columns={['Показатель', 'Август', 'Сентябрь', 'Октябрь']}
                rows={[
                  { id: 'calls', cells: ['Звонки', '726', '742', '758'] },
                  { id: 'minutes', cells: ['Минуты', '1 016', '1 039', '1 062'] },
                ]}
              />
              <div className={styles.auditTip}>
                <span>Обсудите телефонию с клиентом. В демо около 1 000 минут в месяц.</span>
                <button type="button" onClick={showPortrait}>
                  Портрет → «Звонки»
                </button>
              </div>
            </div>
          ) : (
            <p className={styles.muted}>Сводку звонков ещё не собирали.</p>
          )}
        </div>
      </Panel>
      <Panel
        title="Дубли контактов"
        hint="Сравнение нормализованных телефонов и адресов почты."
        action={
          <button type="button" data-variant="primary" onClick={() => setDuplicates(true)}>
            Проверить дубли
          </button>
        }
      >
        <p className={styles.bordered} role="status">
          {duplicates
            ? 'Демо-проверка: 3 группы по телефону, 1 группа по электронной почте.'
            : 'Проверки ещё не было.'}
        </p>
      </Panel>
      <Panel
        title="Воронки amoCRM"
        hint="Количество и сумма созданных и закрытых сделок за период."
      >
        <form
          className={styles.peopleForm}
          onSubmit={(event) => {
            event.preventDefault()
            setPeriod(range)
          }}
        >
          <label>
            Дата с
            <input
              type="date"
              value={range.from}
              max={range.to || undefined}
              required
              onChange={(event) => setRange({ ...range, from: event.target.value })}
            />
          </label>
          <label>
            Дата по
            <input
              type="date"
              value={range.to}
              min={range.from || undefined}
              required
              onChange={(event) => setRange({ ...range, to: event.target.value })}
            />
          </label>
          <button type="submit">Загрузить по периоду</button>
        </form>
        <details className={styles.funnel} open>
          <summary>
            Воронка{' '}
            <small>
              {period
                ? `${formatDate(period.from)} – ${formatDate(period.to)} · ${deals.length} сделок`
                : 'Выберите период, чтобы увидеть итог'}
            </small>
          </summary>
          <Table
            columns={pipelineColumns}
            rows={[
              ...rows,
              {
                id: 'total',
                cells: [
                  'Итого',
                  period ? String(deals.length) : '—',
                  period ? money.format(deals.reduce((sum, deal) => sum + deal.amount, 0)) : '—',
                  period
                    ? String(
                        deals.filter(
                          (deal) =>
                            deal.stage === 'Успешно реализовано' ||
                            deal.stage === 'Закрыто и не реализовано',
                        ).length,
                      )
                    : '—',
                  period
                    ? money.format(
                        deals
                          .filter(
                            (deal) =>
                              deal.stage === 'Успешно реализовано' ||
                              deal.stage === 'Закрыто и не реализовано',
                          )
                          .reduce((sum, deal) => sum + deal.amount, 0),
                      )
                    : '—',
                ],
              },
            ]}
          />
        </details>
        <details className={styles.funnel}>
          <summary>Онлайн</summary>
          <p className={styles.empty}>Для этой воронки в демо нет записей.</p>
        </details>
      </Panel>
    </div>
  )
}
