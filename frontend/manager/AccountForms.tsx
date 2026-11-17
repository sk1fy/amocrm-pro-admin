import type { ReactNode } from 'react'
import type { AccountCommand } from './accountsApi'
import { CommandFeedback, useAccountCommand, VersionConflict } from './accountCommands'
import styles from './Accounts.module.css'

type Fields = Record<string, string>
type EditorProps = Parameters<typeof useAccountCommand>[1]

export function AccountForm({
  id,
  title,
  version,
  initial,
  command,
  onSaved,
  onExpired,
  onForbidden,
  children,
  current,
  submitLabel = 'Сохранить',
}: EditorProps & {
  id: string
  title: string
  version: number
  initial: Fields
  submitLabel?: string
  command: (fields: Fields, original: Fields, version: number, key: string) => AccountCommand
  children: (values: Fields, edit: (name: string, value: string) => void) => ReactNode
  current?: ReactNode
}) {
  const attempt = useAccountCommand(id, { onSaved, onExpired, onForbidden })
  const { draft, state } = attempt.entry
  return (
    <section className={styles.panel} aria-label={title}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft) return
          attempt.start(command(draft.values, draft.original, draft.base, crypto.randomUUID()))
        }}
      >
        <p className={styles.meta}>Версия {draft?.base ?? version}</p>
        <fieldset className={styles.fields} disabled={attempt.locked}>
          <legend>{title}</legend>
          {children(draft?.values ?? initial, (name, value) =>
            attempt.edit(name, value, initial, version),
          )}
        </fieldset>
        <div className={styles.actions}>
          <button type="submit" disabled={!draft || attempt.locked || state.kind === 'conflict'}>
            {submitLabel}
          </button>
        </div>
      </form>
      <VersionConflict command={attempt} version={version} latest={initial}>
        {current}
      </VersionConflict>
      <CommandFeedback command={attempt} />
    </section>
  )
}
