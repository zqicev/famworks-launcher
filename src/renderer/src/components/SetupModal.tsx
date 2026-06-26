import { useState } from 'react'
import styles from '../styles/SetupModal.module.css'

interface Props {
  onComplete: (path: string) => void
}

export default function SetupModal({ onComplete }: Props) {
  const [path, setPath] = useState('')

  const pickFolder = async () => {
    const p = await window.api.dialog.pickFolder()
    if (p) setPath(p)
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.logo}>
          <span>FAM</span><span className={styles.accent}>WORKS</span>
        </div>
        <h2 className={styles.title}>Добро пожаловать</h2>
        <p className={styles.desc}>
          Укажите папку, куда лаунчер будет устанавливать сборки Minecraft.
          Потребуется несколько гигабайт свободного места.
        </p>

        <div className={styles.pathRow}>
          <div className={styles.pathDisplay}>
            {path || <span className={styles.placeholder}>Папка не выбрана</span>}
          </div>
          <button className={styles.browseBtn} onClick={pickFolder}>
            Обзор
          </button>
        </div>

        <button
          className={styles.startBtn}
          disabled={!path}
          onClick={() => onComplete(path)}
        >
          Начать
        </button>
      </div>
    </div>
  )
}
