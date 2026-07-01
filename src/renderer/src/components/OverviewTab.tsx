import { useState, useEffect } from 'react'
import { Modpack } from '../../../types/modpack'
import styles from '../styles/OverviewTab.module.css'

interface Props { modpack: Modpack; busyId: string | null }

type World = { kind: 'world'; folder: string; name: string; lastPlayed: number; mode: string; icon: string | null }
type Server = { kind: 'server'; name: string; ip: string; icon: string | null }
type Recent = { worlds: World[]; servers: Server[] }
type PingResult = { online: number; max: number; favicon: string | null; ping: number; motd: string; version: string } | null
type PingState = { loading: boolean; data: PingResult }

export default function OverviewTab({ modpack, busyId }: Props) {
  const totalMB = modpack.mods.reduce((s, m) => s + m.size_mb, 0)
  const sizeFmt = totalMB >= 1000 ? `${(totalMB / 1024).toFixed(1)} ГБ` : `${totalMB.toFixed(0)} МБ`

  const [recent, setRecent] = useState<Recent>({ worlds: [], servers: [] })
  const [pings, setPings] = useState<Record<string, PingState>>({})

  useEffect(() => {
    let alive = true
    window.api.recentGet(modpack.id).then((r) => {
      if (!alive) return
      setRecent(r)
      // Пингуем каждый сервер отдельно (может занять до 3с)
      for (const s of r.servers) {
        setPings((p) => ({ ...p, [s.ip]: { loading: true, data: null } }))
        window.api.serverPing(s.ip).then((data) => {
          if (alive) setPings((p) => ({ ...p, [s.ip]: { loading: false, data } }))
        })
      }
    }).catch(() => {})
    return () => { alive = false }
  }, [modpack.id])

  const locked = !!busyId
  const playWorld = (folder: string): void => { window.api.launch.start(modpack.id, { type: 'singleplayer', identifier: folder }) }
  const playServer = (ip: string): void => { window.api.launch.start(modpack.id, { type: 'multiplayer', identifier: ip }) }

  const worlds = recent.worlds.slice(0, 4)
  const servers = recent.servers.slice(0, 4)
  const hasRecent = worlds.length > 0 || servers.length > 0

  return (
    <div className={styles.wrapper}>
      <div className={styles.left}>
        {hasRecent && (
          <section className={styles.section}>
            <div className={styles.label}>ПРОДОЛЖИТЬ ИГРУ</div>
            <div className={styles.recentGrid}>
              {servers.map((s) => {
                const st = pings[s.ip]
                const icon = st?.data?.favicon || s.icon
                return (
                  <div key={'s:' + s.ip} className={styles.recentCard}>
                    <div className={styles.recentIcon}>
                      {icon ? <img src={icon} alt="" className={styles.iconImg} /> : <span className={styles.iconFallback}>🖥</span>}
                    </div>
                    <div className={styles.recentInfo}>
                      <div className={styles.recentName}>{s.name}</div>
                      <div className={styles.recentSub}>
                        <ServerStatus state={st} />
                      </div>
                    </div>
                    <button
                      className={styles.recentPlay}
                      onClick={() => playServer(s.ip)}
                      disabled={locked}
                      title="Играть"
                    >▶</button>
                  </div>
                )
              })}
              {worlds.map((w) => (
                <div key={'w:' + w.folder} className={styles.recentCard}>
                  <div className={styles.recentIcon}>
                    {w.icon ? <img src={w.icon} alt="" className={styles.iconImg} /> : <span className={styles.iconFallback}>🌍</span>}
                  </div>
                  <div className={styles.recentInfo}>
                    <div className={styles.recentName}>{w.name}</div>
                    <div className={styles.recentSub}>{w.mode} · {fmtLastPlayed(w.lastPlayed)}</div>
                  </div>
                  <button
                    className={styles.recentPlay}
                    onClick={() => playWorld(w.folder)}
                    disabled={locked}
                    title="Играть"
                  >▶</button>
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
              {modpack.changelog.map((entry) => (
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
          <span className={styles.paramVal}>{modpack.loader.charAt(0).toUpperCase() + modpack.loader.slice(1)}</span>
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

function ServerStatus({ state }: { state: PingState | undefined }): JSX.Element {
  if (!state || state.loading) return <span className={styles.statusChecking}>проверка…</span>
  if (!state.data) return <span className={styles.statusOffline}><span className={styles.dotOff} />офлайн</span>
  const { online, max, ping } = state.data
  return (
    <span className={styles.statusOnline}>
      <span className={styles.dotOn} />
      {online}/{max} онлайн
      <span className={styles.pingVal}>{ping} мс</span>
    </span>
  )
}

function fmtLastPlayed(ms: number): string {
  if (!ms) return ''
  const now = new Date()
  const d = new Date(ms)
  const days = Math.floor((startOfDay(now) - startOfDay(d)) / 86400000)
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} дн. назад`
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return iso
  }
}
