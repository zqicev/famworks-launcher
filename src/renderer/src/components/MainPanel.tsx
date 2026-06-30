import { useState } from 'react'
import { Modpack } from '../../../types/modpack'
import ModsTab from './ModsTab'
import PackTab from './PackTab'
import OverviewTab from './OverviewTab'
import BottomBar from './BottomBar'
import styles from '../styles/MainPanel.module.css'

interface Props {
  modpack: Modpack | null
  installPath: string
  loading: boolean
  error: string | null
}

function formatSize(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} ГБ`
  return `${mb.toFixed(0)} МБ`
}

export default function MainPanel({ modpack, installPath, loading, error }: Props) {
  const [tab, setTab] = useState<'mods' | 'resourcepacks' | 'shaders' | 'overview'>('mods')
  const [extraCount, setExtraCount] = useState(0)

  if (loading) {
    return (
      <main className={styles.main}>
        <div className={styles.center}><div className={styles.spinner} /></div>
      </main>
    )
  }

  if (error) {
    return (
      <main className={styles.main}>
        <div className={styles.center}><p className={styles.error}>{error}</p></div>
      </main>
    )
  }

  if (!modpack) {
    return (
      <main className={styles.main}>
        <div className={styles.center}><p className={styles.hint}>Выберите сборку</p></div>
      </main>
    )
  }

  const modsDir = `${installPath}/${modpack.id}/mods`
  const rpDir = `${installPath}/${modpack.id}/resourcepacks`
  const shDir = `${installPath}/${modpack.id}/shaderpacks`
  const totalMods = modpack.mods.length + extraCount
  const totalSizeMb = modpack.mods.reduce((s, m) => s + m.size_mb, 0)

  return (
    <main className={styles.main}>
      <div className={styles.header} key={modpack.id}>
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
            className={`${styles.tab} ${tab === 'resourcepacks' ? styles.tabActive : ''}`}
            onClick={() => setTab('resourcepacks')}
          >
            РЕСУРСПАКИ
          </button>
          <button
            className={`${styles.tab} ${tab === 'shaders' ? styles.tabActive : ''}`}
            onClick={() => setTab('shaders')}
          >
            ШЕЙДЕРЫ
          </button>
          <button
            className={`${styles.tab} ${tab === 'overview' ? styles.tabActive : ''}`}
            onClick={() => setTab('overview')}
          >
            ОБЗОР
          </button>

          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statVal}>{totalMods}</span>
              <span className={styles.statLabel}>МОДОВ ВСЕ</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statVal}>{formatSize(totalSizeMb)}</span>
              <span className={styles.statLabel}>РАЗМЕР</span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.content} key={`${modpack.id}-${tab}`}>
        {tab === 'mods' && <ModsTab modpack={modpack} modsDir={modsDir} onExtraCountChange={setExtraCount} />}
        {tab === 'resourcepacks' && <PackTab modpack={modpack} dir={rpDir} items={modpack.resourcepacks ?? []} kind="resourcepack" noun="ресурспаков" />}
        {tab === 'shaders' && <PackTab modpack={modpack} dir={shDir} items={modpack.shaders ?? []} kind="shader" noun="шейдеров" />}
        {tab === 'overview' && <OverviewTab modpack={modpack} />}
      </div>

      <BottomBar modpack={modpack} installPath={installPath} extraModsCount={extraCount} />
    </main>
  )
}
