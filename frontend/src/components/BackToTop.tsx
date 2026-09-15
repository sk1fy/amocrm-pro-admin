import { useEffect, useState } from 'react'
import styles from './BackToTop.module.css'

type Props = {
  thresholdPx?: number
}

export function BackToTop({ thresholdPx = 640 }: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > thresholdPx)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [thresholdPx])

  if (!visible) {
    return null
  }

  return (
    <button
      type="button"
      className={styles.button}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      Наверх
    </button>
  )
}
