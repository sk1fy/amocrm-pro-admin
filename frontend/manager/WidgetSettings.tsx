import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useAccountCommand } from './accountCommands'
import type { AccountAccess } from './AccountsPage'
import { ProductEditor } from './ProductEditor'
import type { Product } from './productsApi'
import styles from './WidgetSettings.module.css'

export function WidgetSettings({
  selection,
  product,
  canWrite,
  onSaved,
  onClose,
  children,
  ...access
}: AccountAccess & {
  selection: string
  product?: Product
  canWrite: boolean
  onSaved: (product?: Product) => void
  onClose: () => void
  children: ReactNode
}) {
  const panel = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const continueButton = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const formId = useId()
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const attempt = useAccountCommand('product:' + selection, { ...access, onSaved })
  const { draft, state } = attempt.entry
  const editable = Boolean(product) && canWrite
  const dirty =
    draft && Object.entries(draft.values).some(([name, value]) => value !== draft.original[name])

  useLayoutEffect(() => {
    const dialog = panel.current
    if (!dialog) return
    const trigger = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (trigger instanceof HTMLElement && trigger !== document.body && trigger.isConnected) {
        trigger.focus({ preventScroll: true })
      }
    }
  }, [])

  useLayoutEffect(() => {
    if (confirmDiscard) continueButton.current?.focus()
  }, [confirmDiscard])

  function requestClose() {
    if (confirmDiscard) {
      setConfirmDiscard(false)
      closeButton.current?.focus()
    } else if (editable && dirty && !attempt.locked) {
      setConfirmDiscard(true)
    } else {
      onClose()
    }
  }

  return (
    <dialog
      ref={panel}
      className={styles.drawer}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
    >
      <header className={styles.header}>
        <div>
          <h2 id={titleId}>Настройки виджета</h2>
          {product ? <p>{product.code}</p> : null}
        </div>
        <button
          ref={closeButton}
          className={styles.close}
          type="button"
          aria-label="Закрыть настройки"
          onClick={requestClose}
        >
          ×
        </button>
      </header>
      <div className={styles.body}>
        {product ? (
          <ProductEditor product={product} attempt={attempt} editable={editable} formId={formId} />
        ) : null}
        {children}
      </div>
      <footer className={styles.footer}>
        {confirmDiscard ? (
          <>
            <p role="alert">Закрыть настройки без сохранения изменений?</p>
            <button ref={continueButton} type="button" onClick={requestClose}>
              Продолжить редактирование
            </button>
            <button
              type="button"
              onClick={() => {
                attempt.discardDraft()
                onClose()
              }}
            >
              Закрыть без сохранения
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={requestClose}>
              {editable && !attempt.locked ? 'Отменить' : 'Закрыть'}
            </button>
            {editable ? (
              <button
                className={styles.primary}
                type="submit"
                form={formId}
                aria-label="Сохранить виджет"
                disabled={attempt.locked || state.kind === 'conflict' || !dirty}
              >
                Сохранить
              </button>
            ) : null}
          </>
        )}
      </footer>
    </dialog>
  )
}
