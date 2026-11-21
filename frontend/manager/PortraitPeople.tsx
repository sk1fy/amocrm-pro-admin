import { useState, type KeyboardEvent } from 'react'
import { createRequestKey } from '../src/features/operations/intents'
import { AccountForm } from './AccountForms'
import type { AccountActions } from './AccountOverview'
import type { Portrait } from './accountsApi'
import styles from './PortraitPeople.module.css'

type Person = Portrait['people'][number]
type PersonRole = Person['roles'][number]
type EditPeople = (people: Person[]) => void

const requiredRoles = ['decision_maker', 'influencer', 'billing', 'setup'] as const
const allRoles = [...requiredRoles, 'partner'] as const
const roleLabels = {
  decision_maker: 'ЛПР',
  influencer: 'ЛВР',
  billing: 'Счета',
  setup: 'Настройки',
  partner: 'Партнёр',
} satisfies Record<PersonRole, string>

const maxPeople = 50
const maxNameLength = 160
const maxPhoneLength = 32
const maxLinkLength = 64
const validPhone = /^\+?[0-9(). -]*[0-9][0-9(). -]*$/
const validLink = /^https:\/\/rakurscrm\.amocrm\.ru\/contacts\/detail\/[1-9][0-9]{0,18}\/?$/
const emptyFields = { name: '', phone: '', crm_url: '' }

function readPeople(value: string): Person[] {
  return JSON.parse(value) as Person[]
}

function addOnEnter(event: KeyboardEvent<HTMLInputElement>, action: () => void) {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
  event.preventDefault()
  action()
}

function checkContactLink(value: string) {
  return !value || validLink.test(value)
}

function PeopleHeading({ people }: { people: Person[] }) {
  const covered = new Set(people.flatMap((person) => person.roles))
  const missing = requiredRoles.filter((role) => !covered.has(role))
  return (
    <header className={styles.heading}>
      <h3>Люди</h3>
      <span>
        {requiredRoles.length - missing.length} из {requiredRoles.length} ролей
      </span>
      {missing.length > 0 ? (
        <span className={styles.missing}>
          Без человека · {missing.map((role) => roleLabels[role]).join(', ')}
        </span>
      ) : null}
    </header>
  )
}

function ContactLink({
  person,
  save,
}: {
  person: Person
  save?: (value: string | undefined) => void
}) {
  const [edit, setEdit] = useState(false)
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)

  function apply() {
    const trimmed = value.trim()
    if (!checkContactLink(trimmed)) {
      setInvalid(true)
      return
    }
    save?.(trimmed || undefined)
    setEdit(false)
  }

  return edit ? (
    <div className={styles.linkEditor}>
      <label>
        Ссылка на контакт в rakurscrm
        <input
          inputMode="url"
          maxLength={maxLinkLength}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setInvalid(false)
          }}
          onKeyDown={(event) => addOnEnter(event, apply)}
        />
      </label>
      {invalid ? (
        <p className={styles.error} role="alert">
          Вставьте ссылку на контакт из rakurscrm.
        </p>
      ) : null}
      <div className={styles.linkActions}>
        <button type="button" onClick={apply}>
          Применить
        </button>
        <button type="button" onClick={() => setEdit(false)}>
          Отменить правку ссылки
        </button>
      </div>
    </div>
  ) : (
    <div className={styles.link}>
      {person.crm_url ? (
        <a href={person.crm_url} target="_blank" rel="noreferrer">
          Контакт в rakurscrm ↗
        </a>
      ) : (
        <span>Контакт в rakurscrm не привязан</span>
      )}
      {save ? (
        <button
          className={styles.linkButton}
          type="button"
          onClick={() => {
            setValue(person.crm_url ?? '')
            setInvalid(false)
            setEdit(true)
          }}
        >
          {person.crm_url ? 'Изменить ссылку' : 'Привязать'}
        </button>
      ) : null}
    </div>
  )
}

function PersonCard({
  person,
  edit,
  remove,
}: {
  person: Person
  edit?: (person: Person) => void
  remove?: () => void
}) {
  return (
    <article className={styles.person}>
      <header className={styles.personHeading}>
        <h4>{person.name}</h4>
        {remove ? (
          <button
            type="button"
            className={styles.remove}
            aria-label={'Удалить ' + person.name}
            onClick={remove}
          >
            ×
          </button>
        ) : null}
      </header>
      {person.phone ? (
        <a href={'tel:' + person.phone.replace(/[(). -]/g, '')}>{person.phone}</a>
      ) : (
        <span className={styles.meta}>Телефон не указан</span>
      )}
      <ContactLink
        person={person}
        save={edit ? (value) => edit({ ...person, crm_url: value }) : undefined}
      />
      {edit || person.roles.length ? (
        <div className={styles.roles} role="group" aria-label={'Роли · ' + person.name}>
          {allRoles.map((role) => {
            const selected = person.roles.includes(role)
            if (!edit) return selected ? <span key={role}>{roleLabels[role]}</span> : null
            return (
              <button
                key={role}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  edit({
                    ...person,
                    roles: selected
                      ? person.roles.filter((value) => value !== role)
                      : [...person.roles, role],
                  })
                }
              >
                {roleLabels[role]}
              </button>
            )
          })}
        </div>
      ) : null}
    </article>
  )
}

function AddPerson({ add }: { add: (person: Person) => void }) {
  const [fields, setFields] = useState(emptyFields)
  const [error, setError] = useState('')
  const edit = (field: keyof typeof emptyFields, value: string) => {
    setFields((previous) => ({ ...previous, [field]: value }))
    setError('')
  }
  function submit() {
    const { name, phone, crm_url } = {
      name: fields.name.trim(),
      phone: fields.phone.trim(),
      crm_url: fields.crm_url.trim(),
    }
    if (!name || [...name].length > maxNameLength || /\p{Cc}/u.test(name)) {
      setError('Введите имя длиной до 160 символов.')
      return
    }
    if (phone && (phone.length > maxPhoneLength || !validPhone.test(phone))) {
      setError('Укажите телефон цифрами. Можно использовать знак +, скобки, пробелы и дефисы.')
      return
    }
    if (!checkContactLink(crm_url)) {
      setError('Вставьте ссылку на контакт из rakurscrm.')
      return
    }
    add({
      id: createRequestKey(),
      name,
      phone: phone || undefined,
      crm_url: crm_url || undefined,
      roles: [],
    })
    setFields(emptyFields)
    setError('')
  }
  return (
    <div className={styles.add}>
      <h4>Добавить человека</h4>
      <label>
        <span className={styles.hiddenLabel}>Имя</span>
        <input
          placeholder="Имя — обязательно"
          maxLength={maxNameLength * 2}
          value={fields.name}
          aria-required="true"
          onChange={(event) => edit('name', event.target.value)}
          onKeyDown={(event) => addOnEnter(event, submit)}
        />
      </label>
      <label>
        <span className={styles.hiddenLabel}>Телефон</span>
        <input
          type="tel"
          placeholder="Телефон, если есть"
          maxLength={maxPhoneLength}
          value={fields.phone}
          onChange={(event) => edit('phone', event.target.value)}
          onKeyDown={(event) => addOnEnter(event, submit)}
        />
      </label>
      <label>
        <span className={styles.hiddenLabel}>Ссылка на контакт в rakurscrm</span>
        <input
          inputMode="url"
          placeholder="Ссылка в rakurscrm, если есть"
          maxLength={maxLinkLength}
          value={fields.crm_url}
          onChange={(event) => edit('crm_url', event.target.value)}
          onKeyDown={(event) => addOnEnter(event, submit)}
        />
      </label>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" onClick={submit}>
        Добавить
      </button>
    </div>
  )
}

function PeopleGrid({ people, edit }: { people: Person[]; edit?: EditPeople }) {
  return (
    <>
      <PeopleHeading people={people} />
      {people.length || edit ? (
        <div className={styles.grid}>
          {people.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              edit={
                edit
                  ? (updated) =>
                      edit(people.map((item) => (item.id === person.id ? updated : item)))
                  : undefined
              }
              remove={edit ? () => edit(people.filter((item) => item.id !== person.id)) : undefined}
            />
          ))}
          {edit && people.length < maxPeople ? (
            <AddPerson add={(added) => edit([...people, added])} />
          ) : null}
        </div>
      ) : (
        <p className={styles.meta}>Люди пока не добавлены.</p>
      )}
      {edit && people.length >= maxPeople ? (
        <p className={styles.meta}>Можно добавить до {maxPeople} человек.</p>
      ) : null}
    </>
  )
}

export function PortraitPeople({
  portrait,
  canWrite,
  ...actions
}: AccountActions & { portrait: Portrait; canWrite: boolean }) {
  const { people } = portrait
  if (!canWrite)
    return (
      <section className={styles.section} aria-label="Люди">
        <PeopleGrid people={people} />
      </section>
    )

  return (
    <div className={styles.section}>
      <AccountForm
        {...actions}
        inline
        actionsOnEdit
        id={portrait.account_id + ':portrait-people'}
        title="Люди"
        version={portrait.version}
        initial={{ people: JSON.stringify(people) }}
        current={<PeopleGrid people={people} />}
        submitLabel="Сохранить людей"
        command={(fields, original, version, key) => ({
          kind: 'portrait',
          account: portrait.account_id,
          version,
          key,
          body:
            fields.people === original.people
              ? '{}'
              : JSON.stringify({ people: readPeople(fields.people) }),
        })}
      >
        {(fields, edit) => (
          <PeopleGrid
            people={readPeople(fields.people)}
            edit={(updated) => edit('people', JSON.stringify(updated))}
          />
        )}
      </AccountForm>
    </div>
  )
}
