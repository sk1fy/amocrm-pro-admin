import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useAccountCommand } from './accountCommands'
import type { AccountAccess } from './AccountsPage'
import { ProductEditor } from './ProductEditor'
import type { Product } from './productsApi'
import styles from './WidgetSettings.module.css'

export function WidgetSettings({
  selection,
  creating,
  technicalControls,
  metrics,
  product,
  canWrite,
  onSaved,
  onClose,
  children,
  ...access
}: AccountAccess & {
  creating: boolean
  technicalControls: boolean
  metrics: ReactNode
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
  const [technicalOpen, setTechnicalOpen] = useState(false)
  const showTechnical = technicalControls && technicalOpen
  const editable = (creating || Boolean(product)) && canWrite
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
      data-creating={creating}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
    >
      <header className={styles.header}>
        <div>
          <h2 id={titleId}>{creating ? 'Новый виджет' : 'Настройки виджета'}</h2>
          {product ? <p>{product.code}</p> : null}
        </div>
        {technicalControls ? (
          <button
            className={styles.toggle}
            aria-label="Технический режим"
            title="Технические настройки"
            type="button"
            aria-pressed={showTechnical}
            onClick={() => setTechnicalOpen(!showTechnical)}
          >
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            >
              <path
                d="m9.5 3 .6-1h3.8l.6 2.4 1.7 1 2.4-.7 1.9 3.3-1.8 1.8v2.4l1.8 1.8-1.9 3.3-2.4-.7-1.7 1-.6 2.4h-3.8l-.6-2.4-1.7-1-2.4.7-1.9-3.3 1.8-1.8V9.8L3.5 8l1.9-3.3 2.4.7 1.7-1Z"
                transform="translate(0 1)"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        ) : null}
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
        {product || creating ? (
          <ProductEditor
            showTechnical={showTechnical}
            product={product}
            attempt={attempt}
            editable={editable}
            formId={formId}
          />
        ) : null}
        {children}
        {showTechnical ? metrics : null}
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
                aria-label={creating ? 'Создать виджет' : 'Сохранить виджет'}
                disabled={attempt.locked || state.kind === 'conflict' || !dirty}
              >
                {creating ? 'Создать виджет' : 'Сохранить'}
              </button>
            ) : null}
          </>
        )}
      </footer>
    </dialog>
  )
}
