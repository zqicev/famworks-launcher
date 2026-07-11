import styles from '../styles/SettingsModal.module.css'

interface Props {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

export default function ConfirmModal({ title, message, confirmLabel = 'Удалить', danger, onConfirm, onClose }: Props) {
  return (
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.modal} style={{ width: 420 }} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>
        <div className={styles.body}>
          <p className={styles.hint} style={{ fontSize: 13, lineHeight: 1.6 }}>{message}</p>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Отмена</button>
          <button className={styles.saveBtn} style={danger ? { background: 'var(--red)', color: '#fff' } : undefined}
            onClick={() => { onConfirm(); onClose() }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
