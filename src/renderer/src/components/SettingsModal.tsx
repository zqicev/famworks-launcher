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
                <button className={styles.browseBtn} onClick={() => window.api.shell.openFolder(path)} title="Открыть в проводнике">📁</button>
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
