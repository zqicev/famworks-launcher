import { useState, useEffect } from 'react'
import styles from '../styles/TitleBar.module.css'

export default function TitleBar() {
  const [maxed, setMaxed] = useState(false)

  useEffect(() => {
    window.api.window.isMaximized().then(setMaxed).catch(() => {})
    return window.api.window.onMaximized(setMaxed)
  }, [])

  return (
    <div className={styles.bar}>
      <div className={styles.drag} />
      <div className={styles.controls}>
        <button onClick={() => window.api.window.minimize()} className={styles.btn} title="Свернуть">─</button>
        <button onClick={() => window.api.window.maximize()} className={styles.btn} title={maxed ? 'Восстановить' : 'Развернуть'}>
          {maxed ? (
            // Восстановить — два квадрата
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="1" y="3.2" width="5.8" height="5.8" rx="1" />
              <path d="M3.4 3.2 V2 A1 1 0 0 1 4.4 1 H7.8 A1 1 0 0 1 8.8 2 V5.4 A1 1 0 0 1 7.8 6.4 H6.6" />
            </svg>
          ) : (
            // Развернуть — один квадрат
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3">
              <rect x="1" y="1" width="8" height="8" rx="1" />
            </svg>
          )}
        </button>
        <button onClick={() => window.api.window.close()} className={styles.btnClose} title="Закрыть">✕</button>
      </div>
    </div>
  )
}
