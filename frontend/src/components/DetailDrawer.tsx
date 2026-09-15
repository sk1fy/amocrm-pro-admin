import { useEffect, useId, useRef, type ReactNode } from 'react'
import styles from './DetailDrawer.module.css'

type Props = {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
}

export function DetailDrawer({ title, open, onClose, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const node = dialog.current
    if (!node) {
      return
    }
    if (open && !node.open) {
      node.showModal()
    }
    if (!open && node.open) {
      node.close()
    }
  }, [open])

  return (
    <dialog ref={dialog} className={styles.drawer} aria-labelledby={titleId} onClose={onClose}>
      <header className={styles.head}>
        <h2 id={titleId}>{title}</h2>
        <button type="button" onClick={onClose}>
          Закрыть
        </button>
      </header>
      <div className={styles.body}>{children}</div>
    </dialog>
  )
}
