import { useState } from 'react'
import styles from '../styles/SettingsModal.module.css'

interface Props {
  installPath: string
  onPathChange: (path: string) => void
  onClose: () => void
}

export default function SettingsModal({ installPath, onPathChange, onClose }: Props) {
  const [path, setPath] = useState(installPath)

  const pickFolder = async () => {
    const p = await window.api.dialog.pickFolder()
    if (p) setPath(p)
  }

  const save = async () => {
    await window.api.store.set('installPath', path)
    onPathChange(path)
    onClose()
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Настройки</h2>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          <div className={styles.field}>
            <label className={styles.label}>ПАПКА УСТАНОВКИ</label>
            <div className={styles.pathRow}>
              <div className={styles.pathDisplay}>
                {path || <span className={styles.placeholder}>Не выбрана</span>}
              </div>
              <button className={styles.browseBtn} onClick={pickFolder}>Обзор</button>
              {path && (
                <button className={styles.iconBtn} onClick={() => window.api.shell.openFolder(path)} title="Открыть в проводнике">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 5h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
                  </svg>
                </button>
              )}
            </div>
            <p className={styles.hint}>
              Сборки устанавливаются в отдельные подпапки внутри этой директории.
            </p>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Отмена</button>
          <button className={styles.saveBtn} onClick={save} disabled={!path}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}
