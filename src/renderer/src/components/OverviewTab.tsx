import { useState, useEffect } from 'react'
import { Modpack } from '../../../types/modpack'
import styles from '../styles/OverviewTab.module.css'

interface Props { modpack: Modpack; busyId: string | null }

type Recent = {
  worlds: { kind: 'world'; folder: string; name: string; lastPlayed: number }[]
  servers: { kind: 'server'; name: string; ip: string }[]
}

export default function OverviewTab({ modpack, busyId }: Props) {
  const totalMB = modpack.mods.reduce((s, m) => s + m.size_mb, 0)
  const sizeFmt = totalMB >= 1000
    ? `${(totalMB / 1024).toFixed(1)} ГБ`
    : `${totalMB.toFixed(0)} МБ`

  const [recent, setRecent] = useState<Recent>({ worlds: [], servers: [] })
  useEffect(() => {
    window.api.recentGet(modpack.id).then(setRecent).catch(() => {})
  }, [modpack.id])

  const locked = !!busyId
  const playWorld = (folder: string) => window.api.launch.start(modpack.id, { type: 'singleplayer', identifier: folder })
  const playServer = (ip: string) => window.api.launch.start(modpack.id, { type: 'multiplayer', identifier: ip })

  const items = [
    ...recent.worlds.slice(0, 4).map(w => ({ key: 'w:' + w.folder, icon: '🌍', name: w.name, sub: 'Одиночная игра', onPlay: () => playWorld(w.folder) })),
    ...recent.servers.map(s => ({ key: 's:' + s.ip, icon: '🖥', name: s.name, sub: s.ip, onPlay: () => playServer(s.ip) }))
  ].slice(0, 4)

  return (
    <div className={styles.wrapper}>
      <div className={styles.left}>
        {items.length > 0 && (
          <section className={styles.section}>
            <div className={styles.label}>ПРОДОЛЖИТЬ ИГРУ</div>
            <div className={styles.recentGrid}>
              {items.map(it => (
                <div key={it.key} className={styles.recentCard}>
                  <div className={styles.recentIcon}>{it.icon}</div>
                  <div className={styles.recentInfo}>
                    <div className={styles.recentName}>{it.name}</div>
                    <div className={styles.recentSub}>{it.sub}</div>
                  </div>
                  <button className={styles.recentPlay} onClick={it.onPlay} disabled={locked} title="Играть">▶</button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className={styles.section}>
          <div className={styles.label}>ОПИСАНИЕ</div>
          <p className={styles.text}>{modpack.long_description || modpack.description}</p>
        </section>

        {modpack.changelog?.length > 0 && (
          <section className={styles.section}>
            <div className={styles.label}>ПОСЛЕДНИЕ ИЗМЕНЕНИЯ</div>
            <div className={styles.changelog}>
              {modpack.changelog.map(entry => (
                <div key={entry.version} className={styles.changelogRow}>
                  <span className={styles.version}>{entry.version}</span>
                  <span className={styles.changeDesc}>{entry.description}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className={styles.params}>
        <div className={styles.paramTitle}>ПАРАМЕТРЫ</div>
        <div className={styles.paramRow}>
          <span className={styles.paramKey}>ЗАГРУЗЧИК</span>
          <span className={styles.paramVal}>
            {modpack.loader.charAt(0).toUpperCase() + modpack.loader.slice(1)}
          </span>
        </div>
        <div className={styles.paramRow}>
          <span className={styles.paramKey}>ВЕРСИЯ MC</span>
          <span className={styles.paramVal}>{modpack.mc_version}</span>
        </div>
        <div className={styles.paramRow}>
          <span className={styles.paramKey}>РАЗМЕР</span>
          <span className={styles.paramVal}>{sizeFmt}</span>
        </div>
        <div className={styles.paramRow}>
          <span className={styles.paramKey}>ОБНОВЛЕНО</span>
          <span className={styles.paramVal}>{formatDate(modpack.updated_at)}</span>
        </div>
        <div className={styles.paramRow}>
          <span className={styles.paramKey}>FABRIC API</span>
          <span className={styles.paramVal}>{modpack.fabric_api_version}</span>
        </div>
      </div>
    </div>
  )
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return iso
  }
}
