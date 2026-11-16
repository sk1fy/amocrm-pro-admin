import { useState, type FormEvent } from 'react'
import { staffDraftError, useDemo, type Block } from './DemoSession'
import { dateLabel } from './fixtures'
import styles from './StaffBoard.module.css'

const managerBlocks = [
  {
    id: 'clients',
    name: 'Клиенты',
    description: 'установки, доступы к виджетам, карточки клиентов, amoМаркет',
  },
  {
    id: 'pay',
    name: 'Повторные оплаты',
    description: 'счета, оплаты, продления, бонусы клиентов',
  },
  {
    id: 'partners',
    name: 'Партнёры',
    description: 'партнёрская программа, виджеты и клиенты партнёров',
  },
] as const satisfies readonly { id: Exclude<Block, 'admin'>; name: string; description: string }[]

const blocks = [
  ...managerBlocks,
  {
    id: 'admin',
    name: 'Администратор',
    description: 'всё + настройки виджетов, ссылки, сотрудники и роли',
  },
] as const

function StaffSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  disabled: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className={styles.switch} data-owned={checked} data-locked={disabled}>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        title={disabled ? 'Последний администратор' : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.track} aria-hidden="true" />
      <span aria-hidden="true">{checked ? 'да' : 'нет'}</span>
    </label>
  )
}

export function StaffBoard() {
  const { state, actor, dispatch } = useDemo()
  const [feedback, setFeedback] = useState<{ message: string; error?: true }>()
  const admins = state.staff.filter((employee) => employee.blocks.includes('admin')).length

  function addEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const name = String(data.get('name') ?? '').trim()
    const phone = String(data.get('phone') ?? '').trim()
    const block = managerBlocks.find((entry) => entry.id === data.get('block'))
    const error = staffDraftError(state.staff, name, phone)
    if (error || !block) {
      setFeedback({ message: error || 'Выберите блок доступа.', error: true })
      return
    }
    dispatch({ type: 'addStaff', id: crypto.randomUUID(), name, phone, block: block.id })
    form.reset()
    setFeedback({ message: `Добавлен сотрудник ${name} с доступом «${block.name}».` })
  }

  return (
    <section className={styles.board} aria-labelledby="staff-title">
      <header>
        <h1 id="staff-title">Сотрудники</h1>
        <p className={styles.description}>
          Доступ — по блокам: включите сотруднику нужные. Блоки совмещаются. «Администратор» видит и
          меняет всё, в том числе этот раздел. «Статистика» и «Лента событий» открыты всем. Карточку
          клиента видят все, а продлевать и списывать бонусы может блок «Повторные оплаты».
        </p>
      </header>
      <div className={styles.panel}>
        <div
          className={styles.scroll}
          role="region"
          aria-label="Матрица доступа сотрудников"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to scroll the table.
          tabIndex={0}
        >
          <table className={styles.table}>
            <colgroup>
              <col style={{ width: '20.2%' }} />
              {blocks.map(({ id }) => (
                <col key={id} style={{ width: '18%' }} />
              ))}
              <col style={{ width: '7.8%' }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Сотрудник</th>
                {blocks.map(({ id, name, description }) => (
                  <th key={id} scope="col">
                    {name}
                    <small>{description}</small>
                  </th>
                ))}
                <th scope="col" aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {state.staff.map((employee) => {
                const admin = employee.blocks.includes('admin')
                const locked = admin && admins === 1
                const current = employee.id === actor.id
                return (
                  <tr key={employee.id}>
                    <th scope="row">
                      {employee.name}
                      {employee.demo ? ' (демо)' : ''}
                      <small>
                        {employee.phone} · с {dateLabel(employee.added)}
                        {current ? ' · это вы' : ''}
                      </small>
                    </th>
                    {blocks.map(({ id, name }) => (
                      <td key={id}>
                        {admin && id !== 'admin' ? (
                          <span className={styles.inherited} title="Администратору доступно всё">
                            входит
                          </span>
                        ) : (
                          <StaffSwitch
                            label={`${employee.name}: ${name}`}
                            checked={employee.blocks.includes(id)}
                            disabled={id === 'admin' && locked}
                            onChange={(checked) =>
                              dispatch({
                                type: 'staff',
                                id: employee.id,
                                blocks: checked
                                  ? [...employee.blocks, id]
                                  : employee.blocks.filter((block) => block !== id),
                              })
                            }
                          />
                        )}
                      </td>
                    ))}
                    <td className={styles.actions}>
                      {!current && !locked && (
                        <button
                          type="button"
                          aria-label={`Убрать: ${employee.name}`}
                          onClick={() => {
                            dispatch({ type: 'removeStaff', id: employee.id })
                            setFeedback({
                              message: `Сотрудник ${employee.name} удалён из списка.`,
                            })
                          }}
                        >
                          Убрать
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <form className={styles.form} aria-label="Добавить сотрудника" onSubmit={addEmployee}>
          <input name="name" placeholder="Имя сотрудника" aria-label="Имя сотрудника" required />
          <input
            name="phone"
            type="tel"
            placeholder="Телефон — логин"
            aria-label="Телефон — логин"
            required
          />
          <select name="block" aria-label="Первый блок" defaultValue="clients">
            {managerBlocks.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <button type="submit" data-variant="primary">
            Добавить
          </button>
          {feedback && (
            <p className={styles.feedback} role={feedback.error ? 'alert' : 'status'}>
              {feedback.message}
            </p>
          )}
        </form>
      </div>
    </section>
  )
}
