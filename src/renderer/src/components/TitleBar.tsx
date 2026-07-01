import styles from '../styles/TitleBar.module.css'

export default function TitleBar() {
  return (
    <div className={styles.bar}>
      <div className={styles.drag} />
      <div className={styles.controls}>
        <button onClick={() => window.api.window.minimize()} className={styles.btn} title="Свернуть">─</button>
        <button onClick={() => window.api.window.maximize()} className={styles.btn} title="Развернуть">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1" y="1" width="8" height="8" rx="1" /></svg>
        </button>
        <button onClick={() => window.api.window.close()} className={styles.btnClose} title="Закрыть">✕</button>
      </div>
    </div>
  )
}
