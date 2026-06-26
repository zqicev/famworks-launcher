import { ModpackIndex } from '../../../types/modpack'
import AccountPanel from './AccountPanel'
import styles from '../styles/Sidebar.module.css'

interface Props {
  index: ModpackIndex | null
  selectedId: string | null
  onSelect: (id: string) => void
  onSettings: () => void
}

export default function Sidebar({ index, selectedId, onSelect, onSettings }: Props) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.logoRow}>
        <div className={styles.logo}>
          <span className={styles.logoF}>FAM</span>
          <span className={styles.logoW}>WORKS</span>
        </div>
        <button className={styles.settingsBtn} onClick={onSettings} title="Настройки">
          ⚙
        </button>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span>СБОРКИ</span>
          <span className={styles.count}>{index?.modpacks.length ?? 0}</span>
        </div>

        <div className={styles.list}>
          {index?.modpacks.map((pack) => (
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
                <div className={styles.name}>{pack.name}</div>
                <div className={styles.meta}>
                  {pack.loader.charAt(0).toUpperCase() + pack.loader.slice(1)} · {pack.mc_version}
                </div>
              </div>
              <div className={`${styles.dot} ${selectedId === pack.id ? styles.dotActive : ''}`} />
            </button>
          ))}
        </div>
      </div>

      <div className={styles.spacer} />
      <AccountPanel />
    </aside>
  )
}
