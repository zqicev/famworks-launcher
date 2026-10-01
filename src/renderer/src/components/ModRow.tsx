import { memo, useState } from 'react'
import { Mod } from '../../../types/modpack'
import styles from '../styles/ModRow.module.css'

interface Props {
  mod: Mod
  icon?: string | null
  enabled: boolean
  notInstalled?: boolean
  channel?: 'test' | 'release'          // показываем переключатель ветки только если задан (famworks + право тестера)
  onChannel?: (mod: Mod, channel: 'test' | 'release') => void
  onToggle: (mod: Mod, enabled: boolean) => void
  onDelete: (mod: Mod) => void
}

function ModRow({ mod, icon, enabled, notInstalled, channel, onChannel, onToggle, onDelete }: Props) {
  const locked = mod.required || !!notInstalled
  const [broken, setBroken] = useState(false)
  return (
    <div className={`${styles.row} ${!enabled ? styles.disabled : ''}`}>
      <div className={styles.avatar} style={{ opacity: enabled ? 1 : 0.4 }}>
        {icon && !broken
          ? <img src={icon} alt="" className={styles.avatarImg} loading="lazy" onError={() => setBroken(true)} />
          : mod.name[0].toUpperCase()}
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

      {channel && onChannel && (
        <div style={{ display: 'flex', borderRadius: 7, overflow: 'hidden', border: '1px solid var(--border)', flexShrink: 0 }} title="Ветка мода с портала FamWorks">
          {(['release', 'test'] as const).map(ch => (
            <button
              key={ch}
              onClick={() => channel !== ch && onChannel(mod, ch)}
              style={{
                padding: '4px 8px', fontSize: 10, fontWeight: 600, letterSpacing: 0.3,
                background: channel === ch ? 'var(--accent)' : 'transparent',
                color: channel === ch ? '#0a0a0a' : 'var(--text-dim)',
                transition: 'background .12s, color .12s'
              }}
            >{ch}</button>
          ))}
        </div>
      )}

      {!mod.required && !notInstalled && (
        <button
          className={styles.deleteBtn}
          onClick={() => onDelete(mod)}
          title="Удалить мод"
        >
          ✕
        </button>
      )}

      <button
        className={`${styles.toggle} ${enabled ? styles.toggleOn : ''} ${locked ? styles.toggleLocked : ''}`}
        onClick={() => !locked && onToggle(mod, !enabled)}
        title={notInstalled ? 'Скачается при установке' : mod.required ? 'Обязательный мод' : enabled ? 'Выключить' : 'Включить'}
      >
        <span className={styles.thumb} />
      </button>
    </div>
  )
}

export default memo(ModRow);