import type { ReactNode } from 'react'
import { createRequestKey } from '../src/features/operations/intents'
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
  onCompleted,
  onExpired,
  onForbidden,
  children,
  current,
  submitLabel = 'Сохранить',
  onCancel,
  inline = false,
  actionsOnEdit = false,
  iconActions = false,
}: EditorProps & {
  id: string
  title: string
  version: number
  initial: Fields
  submitLabel?: string
  onCancel?: () => void
  inline?: boolean
  actionsOnEdit?: boolean
  iconActions?: boolean
  command: (fields: Fields, original: Fields, version: number, key: string) => AccountCommand
  children: (
    values: Fields,
    edit: (name: string, value: string) => void,
    hasDraft: boolean,
  ) => ReactNode
  current?: ReactNode
}) {
  const attempt = useAccountCommand(id, { onSaved, onCompleted, onExpired, onForbidden })
  const { draft, state } = attempt.entry
  return (
    <section className={inline ? undefined : styles.panel} aria-label={title}>
      <form
        className={iconActions ? styles.iconActionForm : styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft) return
          attempt.start(command(draft.values, draft.original, draft.base, createRequestKey()))
        }}
      >
        {inline ? null : <p className={styles.meta}>Версия {draft?.base ?? version}</p>}
        <fieldset
          className={inline ? styles.inlineFields : styles.fields}
          aria-label={inline ? title : undefined}
          disabled={attempt.locked}
        >
          {inline ? null : <legend>{title}</legend>}
          {children(
            draft?.values ?? initial,
            (name, value) => attempt.edit(name, value, initial, version),
            !!draft,
          )}
        </fieldset>
        {!actionsOnEdit || draft ? (
          <div className={styles.actions}>
            <button
              type="submit"
              aria-label={iconActions ? 'Подтвердить изменение статуса' : undefined}
              title={iconActions ? 'Подтвердить' : undefined}
              data-variant={inline ? 'primary' : undefined}
              disabled={!draft || attempt.locked || state.kind === 'conflict'}
            >
              {iconActions ? <span aria-hidden="true">✓</span> : submitLabel}
            </button>
            {onCancel || actionsOnEdit ? (
              <button
                type="button"
                aria-label={iconActions ? 'Отменить изменение статуса' : undefined}
                title={iconActions ? 'Отменить' : undefined}
                disabled={attempt.locked}
                onClick={() => {
                  attempt.discardDraft()
                  onCancel?.()
                }}
              >
                {iconActions ? <span aria-hidden="true">×</span> : 'Отмена'}
              </button>
            ) : null}
          </div>
        ) : null}
      </form>
      <VersionConflict command={attempt} version={version} latest={initial}>
        {current}
      </VersionConflict>
      <CommandFeedback command={attempt} />
    </section>
  )
}
