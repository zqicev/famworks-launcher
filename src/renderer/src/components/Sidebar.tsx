import { useState, useEffect } from 'react'
import { ModpackIndex, Modpack } from '../../../types/modpack'
import AccountPanel from './AccountPanel'
import styles from '../styles/Sidebar.module.css'

interface Props {
  index: ModpackIndex | null
  customPacks: Modpack[]
  selectedId: string | null
  seenUpdates: Record<string, string>
  onSelect: (id: string) => void
  onSettings: () => void
  onRefresh: () => void
  onCreate: () => void
  onDeleteCustom: (id: string) => void
}

export default function Sidebar({ index, customPacks, selectedId, seenUpdates, onSelect, onSettings, onRefresh, onCreate, onDeleteCustom }: Props) {
  const [version, setVersion] = useState('')
  useEffect(() => { window.api.appVersion().then(setVersion).catch(() => {}) }, [])

  const Avatar = ({ name, active }: { name: string; active: boolean }) => (
    <div className={styles.avatar} style={{ background: active ? 'var(--accent)' : 'var(--bg-active)' }}>
      <span style={{ color: active ? '#0a0a0a' : 'var(--text)' }}>{(name[0] ?? '?').toUpperCase()}</span>
    </div>
  )

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

      <div className={styles.scroll}>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span>СБОРКИ</span>
            <span className={styles.count}>{index?.modpacks.length ?? 0}</span>
          </div>
          <div className={styles.list}>
            {index?.modpacks.map((pack) => {
              const hasUpdate = seenUpdates[pack.id] && seenUpdates[pack.id] !== pack.updated_at
              const active = selectedId === pack.id
              return (
                <button key={pack.id} className={`${styles.item} ${active ? styles.active : ''}`} onClick={() => onSelect(pack.id)}>
                  <Avatar name={pack.name} active={active} />
                  <div className={styles.info}>
                    <div className={styles.name}>{pack.name}{hasUpdate && <span className={styles.updateBadge}>ОБНОВЛЕНО</span>}</div>
                    <div className={styles.meta}>{pack.loader.charAt(0).toUpperCase() + pack.loader.slice(1)} · {pack.mc_version}</div>
                  </div>
                  <div className={`${styles.dot} ${active ? styles.dotActive : ''}`} />
                </button>
              )
            })}
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span>МОИ СБОРКИ</span>
            <button className={styles.addMini} onClick={onCreate} title="Создать сборку">+</button>
          </div>
          <div className={styles.list}>
            {customPacks.length === 0 && <div className={styles.emptyHint}>Создай свою сборку →</div>}
            {customPacks.map((pack) => {
              const active = selectedId === pack.id
              return (
                <button key={pack.id} className={`${styles.item} ${active ? styles.active : ''}`} onClick={() => onSelect(pack.id)}>
                  <Avatar name={pack.name} active={active} />
                  <div className={styles.info}>
                    <div className={styles.name}>{pack.name}</div>
                    <div className={styles.meta}>{pack.loader.charAt(0).toUpperCase() + pack.loader.slice(1)} · {pack.mc_version}</div>
                  </div>
                  <button className={styles.delPack} onClick={(e) => { e.stopPropagation(); onDeleteCustom(pack.id) }} title="Удалить сборку">✕</button>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <AccountPanel />
    </aside>
  )
}
