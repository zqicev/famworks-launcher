import { useState } from 'react'
import { Modpack } from '../../../types/modpack'
import ModsTab from './ModsTab'
import OverviewTab from './OverviewTab'
import BottomBar from './BottomBar'
import styles from '../styles/MainPanel.module.css'

interface Props {
  modpack: Modpack | null
  installPath: string
  loading: boolean
  error: string | null
}

export default function MainPanel({ modpack, installPath, loading, error }: Props) {
  const [tab, setTab] = useState<'mods' | 'overview'>('mods')

  if (loading) {
    return (
      <main className={styles.main}>
        <div className={styles.center}>
          <div className={styles.spinner} />
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className={styles.main}>
        <div className={styles.center}>
          <p className={styles.error}>{error}</p>
        </div>
      </main>
    )
  }

  if (!modpack) {
    return (
      <main className={styles.main}>
        <div className={styles.center}>
          <p className={styles.hint}>Выберите сборку</p>
        </div>
      </main>
    )
  }

  const modsDir = `${installPath}/${modpack.id}/mods`
  const activeMods = modpack.mods.filter(m => m.required || true).length

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <div className={styles.badge}>
          ОБНОВЛЕНО · {modpack.loader.toUpperCase()} {modpack.mc_version}
        </div>
        <h1 className={styles.title}>{modpack.name}</h1>
        <p className={styles.desc}>{modpack.description}</p>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'mods' ? styles.tabActive : ''}`}
            onClick={() => setTab('mods')}
          >
            МОДЫ
          </button>
          <button
            className={`${styles.tab} ${tab === 'overview' ? styles.tabActive : ''}`}
            onClick={() => setTab('overview')}
          >
            ОБЗОР
          </button>

          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statVal}>{modpack.mods.length}</span>
              <span className={styles.statLabel}>МОДОВ ВСЕ</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statVal}>
                {modpack.mods.reduce((s, m) => s + m.size_mb, 0).toFixed(1)} ГБ
              </span>
              <span className={styles.statLabel}>РАЗМЕР</span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.content}>
        {tab === 'mods' ? (
          <ModsTab modpack={modpack} modsDir={modsDir} />
        ) : (
          <OverviewTab modpack={modpack} />
        )}
      </div>

      <BottomBar modpack={modpack} installPath={installPath} />
    </main>
  )
}
