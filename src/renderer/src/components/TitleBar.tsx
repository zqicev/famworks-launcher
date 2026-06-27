import styles from '../styles/TitleBar.module.css'

export default function TitleBar() {
  return (
    <div className={styles.bar}>
      <div className={styles.logo}>
        <span className={styles.f}>FAM</span><span className={styles.w}>WORKS</span>
        <span className={styles.tag}>EDITOR</span>
      </div>
      <div className={styles.drag} />
      <div className={styles.controls}>
        <button onClick={() => window.api.win.minimize()} className={styles.btn}>─</button>
        <button onClick={() => window.api.win.close()} className={styles.btnClose}>✕</button>
      </div>
    </div>
  )
}
