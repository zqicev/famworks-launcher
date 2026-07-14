import { useState, useEffect, useCallback } from 'react'
import { Modpack } from '../../../types/modpack'
import ModsTab from './ModsTab'
import PackTab from './PackTab'
import OverviewTab from './OverviewTab'
import LogsTab from './LogsTab'
import DevTab from './DevTab'
import BottomBar from './BottomBar'
import styles from '../styles/MainPanel.module.css'

interface Props {
  modpack: Modpack | null
  installPath: string
  loading: boolean
  error: string | null
  devMode: boolean
  selectedId: string | null
  onOpenBrowser: (type: string) => void
}

function formatSize(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} ГБ`
  return `${mb.toFixed(0)} МБ`
}

async function countDir(dir: string, ext: string): Promise<{ total: number; enabled: number }> {
  const files = await window.api.mods.installed(dir).catch(() => [] as string[])
  const total = new Set(
    files.map(f => f.replace(/\.disabled$/, '')).filter(f => f.toLowerCase().endsWith('.' + ext))
  ).size
  // включён = файл оканчивается ровно на .ext (без .disabled)
  const enabled = files.filter(f => f.toLowerCase().endsWith('.' + ext)).length
  return { total, enabled }
}

export default function MainPanel({ modpack, installPath, loading, error, devMode, selectedId, onOpenBrowser }: Props) {
  const [tab, setTab] = useState<'mods' | 'resourcepacks' | 'shaders' | 'overview' | 'logs' | 'dev'>('overview')
  const [counts, setCounts] = useState({ modsTotal: 0, modsActive: 0, rp: 0, sh: 0 })
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    window.api.busyGet().then(setBusyId).catch(() => {})
    return window.api.onBusyChanged(setBusyId)
  }, [])

  const mpId = modpack?.id
  const refreshCounts = useCallback(async () => {
    if (!mpId) return
    const root = `${installPath}/${mpId}`
    const [mods, rp, sh] = await Promise.all([
      countDir(`${root}/mods`, 'jar'),
      countDir(`${root}/resourcepacks`, 'zip'),
      countDir(`${root}/shaderpacks`, 'zip')
    ])
    setCounts({ modsTotal: mods.total, modsActive: mods.enabled, rp: rp.total, sh: sh.total })
  }, [mpId, installPath])

  useEffect(() => {
    setCounts({
      modsTotal: modpack?.mods?.length ?? 0,
      modsActive: modpack?.mods?.length ?? 0,
      rp: modpack?.resourcepacks?.length ?? 0,
      sh: modpack?.shaders?.length ?? 0
    })
    refreshCounts()
    const off = window.api.install.onProgress((raw: unknown) => {
      if ((raw as { phase: string }).phase === 'done') setTimeout(refreshCounts, 300)
    })
    return off
  }, [mpId, refreshCounts])

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
    // Есть выбор, но данные ещё грузятся (особенно официальные сборки — тянутся из сети) — показываем спиннер
    return (
      <main className={styles.main}>
        <div className={styles.center}>
          {selectedId ? <div className={styles.spinner} /> : <p className={styles.hint}>Выберите сборку</p>}
        </div>
      </main>
    )
  }

  const browseType = tab === 'resourcepacks' ? 'resourcepack' : tab === 'shaders' ? 'shader' : 'mod'

  const modsDir = `${installPath}/${modpack.id}/mods`
  const rpDir = `${installPath}/${modpack.id}/resourcepacks`
  const shDir = `${installPath}/${modpack.id}/shaderpacks`
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
          <button className={`${styles.tab} ${tab === 'overview' ? styles.tabActive : ''}`} onClick={() => setTab('overview')}>
            ОБЗОР
          </button>
          <button className={`${styles.tab} ${tab === 'mods' ? styles.tabActive : ''}`} onClick={() => setTab('mods')}>
            МОДЫ <span className={styles.tabCount}>{counts.modsTotal}</span>
          </button>
          <button className={`${styles.tab} ${tab === 'resourcepacks' ? styles.tabActive : ''}`} onClick={() => setTab('resourcepacks')}>
            РЕСУРСПАКИ <span className={styles.tabCount}>{counts.rp}</span>
          </button>
          <button className={`${styles.tab} ${tab === 'shaders' ? styles.tabActive : ''}`} onClick={() => setTab('shaders')}>
            ШЕЙДЕРЫ <span className={styles.tabCount}>{counts.sh}</span>
          </button>
          <button className={`${styles.tab} ${tab === 'logs' ? styles.tabActive : ''}`} onClick={() => setTab('logs')}>
            ЛОГИ
          </button>
          {devMode && (
            <button className={`${styles.tab} ${tab === 'dev' ? styles.tabActive : ''}`} onClick={() => setTab('dev')}>
              РАЗРАБОТКА
            </button>
          )}

          <button className={styles.browseBtn} onClick={() => onOpenBrowser(browseType)} title="Найти и установить контент">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            ДОБАВИТЬ
          </button>

          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statVal}>{formatSize(totalSizeMb)}</span>
              <span className={styles.statLabel}>РАЗМЕР</span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.content} key={`${modpack.id}-${tab}`}>
        {tab === 'mods' && <ModsTab modpack={modpack} modsDir={modsDir} onCount={(total, active) => setCounts(c => ({ ...c, modsTotal: total, modsActive: active }))} />}
        {tab === 'resourcepacks' && <PackTab dir={rpDir} items={modpack.resourcepacks ?? []} noun="ресурспаков" onCount={n => setCounts(c => ({ ...c, rp: n }))} />}
        {tab === 'shaders' && <PackTab dir={shDir} items={modpack.shaders ?? []} noun="шейдеров" onCount={n => setCounts(c => ({ ...c, sh: n }))} />}
        {tab === 'overview' && <OverviewTab modpack={modpack} busyId={busyId} />}
        {tab === 'logs' && <LogsTab modpackId={modpack.id} />}
        {tab === 'dev' && devMode && <DevTab modpackId={modpack.id} loader={modpack.loader} mcVersion={modpack.mc_version} />}
      </div>

      <BottomBar modpack={modpack} installPath={installPath} activeMods={counts.modsActive} totalMods={counts.modsTotal} />
    </main>
  )
}
