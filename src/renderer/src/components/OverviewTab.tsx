import { useState, useEffect } from 'react'
import { Modpack } from '../../../types/modpack'
import styles from '../styles/OverviewTab.module.css'

interface Props { modpack: Modpack; busyId: string | null }

type World = { kind: 'world'; folder: string; name: string; lastPlayed: number; mode: string; version: string; icon: string | null; score: number }
type Server = { kind: 'server'; name: string; ip: string; icon: string | null; score: number }
type Entry = World | Server
type PingResult = { online: number; max: number; favicon: string | null; ping: number; motd: string; version: string } | null
type PingState = { loading: boolean; data: PingResult }

export default function OverviewTab({ modpack, busyId }: Props) {
  const totalMB = modpack.mods.reduce((s, m) => s + m.size_mb, 0)
  const sizeFmt = totalMB >= 1000 ? `${(totalMB / 1024).toFixed(1)} ГБ` : `${totalMB.toFixed(0)} МБ`

  const [entries, setEntries] = useState<Entry[]>([])
  const [pings, setPings] = useState<Record<string, PingState>>({})

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setInterval> | undefined

    // first=true — показываем «проверка…»; при авто-обновлении держим прежнее значение до ответа
    const pingAll = (ips: string[], first: boolean): void => {
      for (const ip of ips) {
        if (first) setPings((p) => ({ ...p, [ip]: { loading: true, data: null } }))
        window.api.serverPing(ip).then((data) => {
          if (alive) setPings((p) => ({ ...p, [ip]: { loading: false, data } }))
        })
      }
    }

    window.api.recentGet(modpack.id).then((list) => {
      if (!alive) return
      setEntries(list)
      const ips = list.filter((e): e is Server => e.kind === 'server').map((e) => e.ip)
      if (ips.length === 0) return
      pingAll(ips, true)
      timer = setInterval(() => alive && pingAll(ips, false), 180000) // авто-обновление онлайна раз в 3 мин
    }).catch(() => {})

    return () => { alive = false; if (timer) clearInterval(timer) }
  }, [modpack.id])

  const locked = !!busyId
  const play = (e: Entry): void => {
    if (e.kind === 'world') window.api.launch.start(modpack.id, { type: 'singleplayer', identifier: e.folder })
    else window.api.launch.start(modpack.id, { type: 'multiplayer', identifier: e.ip })
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.left}>
        {entries.length > 0 && (
          <section className={styles.section}>
            <div className={styles.label}>ПРОДОЛЖИТЬ ИГРУ</div>
            <div className={styles.recentGrid}>
              {entries.map((e) => {
                const st = e.kind === 'server' ? pings[e.ip] : undefined
                const img = e.kind === 'server' ? (st?.data?.favicon || e.icon) : e.icon
                const version = e.kind === 'world' ? e.version : st?.data?.version
                return (
                  <div key={e.kind === 'world' ? 'w:' + e.folder : 's:' + e.ip} className={styles.recentCard}>
                    <div className={styles.recentIcon}>
                      {img
                        ? <img src={img} alt="" className={styles.iconImg} />
                        : e.kind === 'world' ? <WorldIcon /> : <ServerIcon />}
                    </div>
                    <div className={styles.recentInfo}>
                      <div className={styles.recentName}>
                        <span className={styles.nameText}>{e.name}</span>
                        {version ? <span className={styles.verBadge}>{cleanVersion(version)}</span> : null}
                      </div>
                      <div className={styles.recentSub}>
                        {e.kind === 'world'
                          ? `${e.mode} · ${fmtLastPlayed(e.lastPlayed)}`
                          : <ServerStatus state={st} />}
                      </div>
                    </div>
                    <button className={styles.recentPlay} onClick={() => play(e)} disabled={locked} title="Играть">▶</button>
                  </div>
                )
              })}
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
  if (!state.data) return <span className={styles.statusOffline}><span className={styles.dotOff} />offline</span>
  const { online, max, ping } = state.data
  return (
    <span className={styles.statusOnline}>
      <span className={styles.dotOn} />
      {online}/{max} онлайн
      <span className={styles.pingVal}>{ping} мс</span>
    </span>
  )
}

/** Фирменная заглушка мира — изометрический блок травы в акцентных тонах. */
function WorldIcon(): JSX.Element {
  return (
    <div className={`${styles.iconFallback} ${styles.fbWorld}`}>
      <svg viewBox="0 0 46 46" className={styles.iconSvg} xmlns="http://www.w3.org/2000/svg">
        <polygon points="23,9 37,17 23,25 9,17" fill="#c5f82a" />
        <polygon points="9,17 23,25 23,39 9,31" fill="#6f9418" />
        <polygon points="23,25 37,17 37,31 23,39" fill="#557214" />
        <polygon points="23,9 37,17 23,25 9,17" fill="none" stroke="#0a0a0a" strokeOpacity="0.15" strokeWidth="0.6" />
      </svg>
    </div>
  )
}

/** Фирменная заглушка сервера — стойка с индикаторами в акцентном цвете. */
function ServerIcon(): JSX.Element {
  return (
    <div className={`${styles.iconFallback} ${styles.fbServer}`}>
      <svg viewBox="0 0 46 46" className={styles.iconSvg} fill="none" stroke="#c5f82a" strokeWidth="2" xmlns="http://www.w3.org/2000/svg">
        <rect x="11" y="13" width="24" height="8.5" rx="2.5" />
        <rect x="11" y="24.5" width="24" height="8.5" rx="2.5" />
        <circle cx="16" cy="17.2" r="1.4" fill="#c5f82a" stroke="none" />
        <circle cx="16" cy="28.7" r="1.4" fill="#c5f82a" stroke="none" />
      </svg>
    </div>
  )
}

/** У серверов version.name бывает «Paper 1.20.1», «Spigot 1.21» — оставляем номер версии. */
function cleanVersion(raw: string): string {
  const m = raw.match(/\d+\.\d+(\.\d+)?/)
  return m ? m[0] : raw.slice(0, 12)
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
