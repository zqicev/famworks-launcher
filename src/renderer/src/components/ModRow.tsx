import { Mod } from '../../../types/modpack'
import styles from '../styles/ModRow.module.css'

interface Props {
  mod: Mod
  enabled: boolean
  notInstalled?: boolean
  onToggle: (enabled: boolean) => void
  onDelete: () => void
}

export default function ModRow({ mod, enabled, notInstalled, onToggle, onDelete }: Props) {
  const locked = mod.required || !!notInstalled
  return (
    <div className={`${styles.row} ${!enabled ? styles.disabled : ''}`}>
      <div className={styles.avatar} style={{ opacity: enabled ? 1 : 0.4 }}>
        {mod.name[0].toUpperCase()}
      </div>

      <div className={styles.info}>
        <div className={styles.nameRow}>
          <span className={styles.name}>{mod.name}</span>
          {mod.category && <span className={styles.category}>{mod.category}</span>}
          {notInstalled && <span className={styles.pending}>не установлен</span>}
        </div>
        <div className={styles.meta}>
          {mod.version ? `${mod.version} · ` : ''}{mod.size_mb} МБ
        </div>
      </div>

      {!mod.required && !notInstalled && (
        <button
          className={styles.deleteBtn}
          onClick={onDelete}
          title="Удалить мод"
        >
          ✕
        </button>
      )}

      <button
        className={`${styles.toggle} ${enabled ? styles.toggleOn : ''} ${locked ? styles.toggleLocked : ''}`}
        onClick={() => !locked && onToggle(!enabled)}
        title={notInstalled ? 'Скачается при установке' : mod.required ? 'Обязательный мод' : enabled ? 'Выключить' : 'Включить'}
      >
        <span className={styles.thumb} />
      </button>
    </div>
  )
}
