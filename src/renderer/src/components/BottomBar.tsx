import { useState, useEffect, useCallback } from 'react'
import { Modpack } from '../../../types/modpack'
import styles from '../styles/BottomBar.module.css'

interface Props {
  modpack: Modpack
  installPath: string
  extraModsCount?: number
}

type ModpackStatus = 'checking' | 'not_installed' | 'outdated' | 'ready' | 'installing' | 'launching' | 'running'

interface ProgressState {
  message: string
  current: number
  total: number
  bytesDownloaded: number
  bytesTotal: number
  speedBps: number
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} Б`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} КБ`
  return `${(b / 1024 / 1024).toFixed(1)} МБ`
}

function formatSpeed(bps: number) {
  if (bps < 1024) return `${bps.toFixed(0)} Б/с`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} КБ/с`
  return `${(bps / 1024 / 1024).toFixed(1)} МБ/с`
}

export default function BottomBar({ modpack, installPath, extraModsCount = 0 }: Props) {
  const [status, setStatus] = useState<ModpackStatus>('checking')
  const [memory, setMemory] = useState(4096)
  const [progress, setProgress] = useState<ProgressState | null>(null)

  const checkStatus = useCallback(async () => {
    setStatus('checking')
    setProgress(null)
    try {
      const s = await window.api.modpacks.status(modpack.id) as 'not_installed' | 'outdated' | 'ready'
      setStatus(s)
    } catch {
      setStatus('not_installed')
    }
  }, [modpack.id])

  useEffect(() => {
    checkStatus()

    window.api.install.onProgress((raw: unknown) => {
      const d = raw as {
        phase: string; message: string
        current?: number; total?: number
        bytesDownloaded?: number; bytesTotal?: number; speedBps?: number
      }
      if (d.phase === 'done') {
        setProgress(null)
        setStatus('ready')
      } else if (d.phase === 'error') {
        setProgress(null)
        setStatus('not_installed')
      } else {
        setProgress({
          message: d.message,
          current: d.current ?? 0,
          total: d.total ?? 0,
          bytesDownloaded: d.bytesDownloaded ?? 0,
          bytesTotal: d.bytesTotal ?? 0,
          speedBps: d.speedBps ?? 0
        })
      }
    })

    window.api.launch.onClose(() => {
      setStatus('ready')
      setProgress(null)
    })

    window.api.launch.onError?.((msg: string) => {
      setProgress({ message: msg, current: 0, total: 0, bytesDownloaded: 0, bytesTotal: 0, speedBps: 0 })
      setStatus('ready')
    })
  }, [modpack.id, checkStatus])

  useEffect(() => {
    window.api.store.get('allocatedMemory').then(v => {
      if (v) setMemory(v as number)
    })
  }, [])

  const handleMemoryChange = async (v: number) => {
    setMemory(v)
    await window.api.store.set('allocatedMemory', v)
  }

  const handleAction = async () => {
    if (status === 'not_installed' || status === 'outdated') {
      setStatus('installing')
      try {
        await window.api.install.modpack(modpack.id)
      } catch {
        setStatus('not_installed')
      }
    } else if (status === 'ready') {
      setStatus('launching')
      try {
        await window.api.launch.start(modpack.id)
        setStatus('running')
      } catch {
        setStatus('ready')
      }
    }
  }

  const isBusy = status === 'checking' || status === 'installing' || status === 'launching'
  const isRunning = status === 'running'

  const btnLabel = {
    checking: 'ПРОВЕРКА...',
    not_installed: 'УСТАНОВИТЬ',
    outdated: 'ОБНОВИТЬ',
    ready: 'ИГРАТЬ',
    installing: 'УСТАНОВКА...',
    launching: 'ЗАПУСК...',
    running: 'ЗАПУЩЕНО'
  }[status]

  const btnAccent = status === 'not_installed' || status === 'outdated' || status === 'ready'

  const progressPct = progress
    ? progress.total > 0
      ? ((progress.current + (progress.bytesTotal > 0 ? progress.bytesDownloaded / progress.bytesTotal : 0)) / progress.total) * 100
      : 0
    : status === 'checking' ? -1  // indeterminate
    : 100

  return (
    <div className={styles.bar}>
      {/* Прогресс-бар сверху */}
      <div className={styles.progressTrack}>
        {(isBusy) && (
          progressPct < 0
            ? <div className={styles.progressIndeterminate} />
            : <div className={styles.progressFill} style={{ width: `${Math.min(progressPct, 100)}%` }} />
        )}
      </div>

      <div className={styles.inner}>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>ВЕРСИЯ</span>
            <span className={styles.statVal}>{modpack.mc_version}</span>
          </div>
          <div className={styles.divider} />
          <div className={styles.stat}>
            <span className={styles.statLabel}>ПАМЯТЬ</span>
            <select
              className={styles.select}
              value={memory}
              onChange={e => handleMemoryChange(Number(e.target.value))}
              disabled={isBusy || isRunning}
            >
              {[2048, 4096, 6144, 8192, 12288, 16384].map(v => (
                <option key={v} value={v}>{v / 1024} ГБ</option>
              ))}
            </select>
          </div>
          <div className={styles.divider} />
          <div className={styles.stat}>
            <span className={styles.statLabel}>МОДОВ АКТИВНО</span>
            <span className={styles.statVal}>{modpack.mods.length + extraModsCount} из {modpack.mods.length + extraModsCount}</span>
          </div>
        </div>

        {/* Статус / прогресс по центру */}
        <div className={styles.statusArea}>
          {progress ? (
            <>
              <div className={styles.statusMsg}>{progress.message}</div>
              <div className={styles.statusSub}>
                {progress.total > 0 && (
                  <span>{progress.current + 1}/{progress.total}</span>
                )}
                {progress.bytesTotal > 0 && (
                  <span>{formatBytes(progress.bytesDownloaded)} / {formatBytes(progress.bytesTotal)}</span>
                )}
                {progress.speedBps > 0 && (
                  <span className={styles.speed}>{formatSpeed(progress.speedBps)}</span>
                )}
              </div>
            </>
          ) : status === 'checking' ? (
            <div className={styles.statusMsg}>Проверка...</div>
          ) : null}
        </div>

        <button
          className={`${styles.playBtn} ${btnAccent ? styles.playBtnAccent : styles.playBtnMuted}`}
          onClick={handleAction}
          disabled={isBusy || isRunning}
        >
          <span className={styles.playLabel}>
            {!isBusy && !isRunning && status === 'ready' && <span className={styles.playIcon}>▶ </span>}
            {btnLabel}
          </span>
          <span className={styles.playSub}>{modpack.name} · {modpack.mc_version}</span>
        </button>
      </div>
    </div>
  )
}
