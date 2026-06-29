import { useState, useEffect } from 'react'
import { ModpackIndex, ModpackSummary } from '../../../types/modpack'
import AccountPanel from './AccountPanel'
import styles from '../styles/Sidebar.module.css'

interface Props {
  index: ModpackIndex | null
  selectedId: string | null
  seenUpdates: Record<string, string>
  onSelect: (id: string) => void
  onSettings: () => void
  onRefresh: () => void
}

export default function Sidebar({ index, selectedId, seenUpdates, onSelect, onSettings, onRefresh }: Props) {
  const [version, setVersion] = useState('')
  useEffect(() => { window.api.appVersion().then(setVersion).catch(() => {}) }, [])

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logoRow}>
        <div className={styles.logo}>
          <span className={styles.logoF}>FAM</span>
          <span className={styles.logoW}>WORKS</span>
          {version && <span className={styles.version}>v{version}</span>}
        </div>
        <div className={styles.logoActions}>
          <button className={styles.iconBtn} onClick={onRefresh} title="Обновить список сборок">↻</button>
          <button className={styles.iconBtn} onClick={onSettings} title="Настройки">⚙</button>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span>СБОРКИ</span>
          <span className={styles.count}>{index?.modpacks.length ?? 0}</span>
        </div>

        <div className={styles.list}>
          {index?.modpacks.map((pack) => {
            const hasUpdate = seenUpdates[pack.id] && seenUpdates[pack.id] !== pack.updated_at
            return (
              <button
                key={pack.id}
                className={`${styles.item} ${selectedId === pack.id ? styles.active : ''}`}
                onClick={() => onSelect(pack.id)}
              >
                <div
                  className={styles.avatar}
                  style={{ background: selectedId === pack.id ? 'var(--accent)' : 'var(--bg-active)' }}
                >
                  <span style={{ color: selectedId === pack.id ? '#0a0a0a' : 'var(--text)' }}>
                    {pack.name[0].toUpperCase()}
                  </span>
                </div>
                <div className={styles.info}>
                  <div className={styles.name}>
                    {pack.name}
                    {hasUpdate && <span className={styles.updateBadge}>ОБНОВЛЕНО</span>}
                  </div>
                  <div className={styles.meta}>
                    {pack.loader.charAt(0).toUpperCase() + pack.loader.slice(1)} · {pack.mc_version}
                  </div>
                </div>
                <div className={`${styles.dot} ${selectedId === pack.id ? styles.dotActive : ''}`} />
              </button>
            )
          })}
        </div>
      </div>

      <div className={styles.spacer} />
      <AccountPanel />
    </aside>
  )
}
