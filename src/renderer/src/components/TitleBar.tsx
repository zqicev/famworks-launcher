import styles from '../styles/TitleBar.module.css'

export default function TitleBar() {
  return (
    <div className={styles.bar}>
      <div className={styles.drag} />
      <div className={styles.controls}>
        <button onClick={() => window.api.window.minimize()} className={styles.btn}>─</button>
        <button onClick={() => window.api.window.close()} className={styles.btnClose}>✕</button>
      </div>
    </div>
  )
}
