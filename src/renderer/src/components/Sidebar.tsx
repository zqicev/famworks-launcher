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
  onImport: () => void
  onExportCustom: (id: string) => void
}

const ImportIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)
const ExportIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

export default function Sidebar({ index, customPacks, selectedId, seenUpdates, onSelect, onSettings, onRefresh, onCreate, onDeleteCustom, onImport, onExportCustom }: Props) {
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
            <div className={styles.headerActions}>
              <button className={styles.miniBtn} onClick={onImport} title="Импорт сборки из файла"><ImportIcon /></button>
              <button className={styles.addMini} onClick={onCreate} title="Создать сборку">+</button>
            </div>
          </div>
          <div className={styles.list}>
            {customPacks.length === 0 && (
              <button className={styles.createCard} onClick={onCreate}>
                <span className={styles.createPlus}>+</span>
                <div className={styles.createText}>
                  <div className={styles.createTitle}>Создать сборку</div>
                  <div className={styles.createSub}>Свои моды, паки и шейдеры</div>
                </div>
              </button>
            )}
            {customPacks.map((pack) => {
              const active = selectedId === pack.id
              return (
                <button key={pack.id} className={`${styles.item} ${active ? styles.active : ''}`} onClick={() => onSelect(pack.id)}>
                  <Avatar name={pack.name} active={active} />
                  <div className={styles.info}>
                    <div className={styles.name}>{pack.name}</div>
                    <div className={styles.meta}>{pack.loader.charAt(0).toUpperCase() + pack.loader.slice(1)} · {pack.mc_version}</div>
                  </div>
                  <div className={styles.itemActions}>
                    <button className={styles.actBtn} onClick={(e) => { e.stopPropagation(); onExportCustom(pack.id) }} title="Экспорт сборки в файл"><ExportIcon /></button>
                    <button className={styles.actBtn} onClick={(e) => { e.stopPropagation(); onDeleteCustom(pack.id) }} title="Удалить сборку"><span className={styles.del}>✕</span></button>
                  </div>
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
