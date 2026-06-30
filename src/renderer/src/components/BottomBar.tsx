import { useState, useEffect, useCallback, useRef } from 'react'
import { Modpack } from '../../../types/modpack'
import MemorySelect from './MemorySelect'
import styles from '../styles/BottomBar.module.css'

// Базовые варианты ОЗУ (МБ); реальные опции фильтруются по объёму системы
const MEMORY_OPTIONS = [2048, 4096, 6144, 8192, 12288, 16384, 24576, 32768]

interface Props {
  modpack: Modpack
  installPath: string
  activeMods?: number
  totalMods?: number
}

type ModpackStatus = 'checking' | 'not_installed' | 'outdated' | 'ready' | 'installing' | 'launching' | 'running'

interface ProgressState {
  message: string
  countCurrent: number
  countTotal: number
  bytesDownloaded: number
  bytesTotal: number
  speedBps: number
}

const EMPTY_PROGRESS: ProgressState = {
  message: '', countCurrent: 0, countTotal: 0, bytesDownloaded: 0, bytesTotal: 0, speedBps: 0
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} Б`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} КБ`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} МБ`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} ГБ`
}

function formatSpeed(bps: number) {
  if (bps < 1024) return `${bps.toFixed(0)} Б/с`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} КБ/с`
  return `${(bps / 1024 / 1024).toFixed(1)} МБ/с`
}

export default function BottomBar({ modpack, installPath, activeMods = 0, totalMods = 0 }: Props) {
  const [status, setStatus] = useState<ModpackStatus>('checking')
  const [memory, setMemory] = useState(4096)
  const [totalRamMb, setTotalRamMb] = useState(16384)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const checkStatus = useCallback(async () => {
    setStatus('checking')
    setProgress(null)
    // Игра этой сборки уже запущена (например, лаунчер перезапустили)?
    const runningId = await window.api.gameRunning().catch(() => null)
    if (runningId === modpack.id) { setStatus('running'); return }
    try {
      const s = await window.api.modpacks.status(modpack.id) as 'not_installed' | 'outdated' | 'ready'
      setStatus(s)
    } catch {
      setStatus('not_installed')
    }
  }, [modpack.id])

  useEffect(() => {
    checkStatus()

    const offProgress = window.api.install.onProgress((raw: unknown) => {
      const d = raw as {
        phase: string; message?: string
        current?: number; total?: number
        bytesDownloaded?: number; bytesTotal?: number; speedBps?: number
      }

      if (d.phase === 'done') {
        if (clearTimer.current) clearTimeout(clearTimer.current)
        clearTimer.current = setTimeout(() => {
          setProgress(null)
          // Если игра уже запущена/запускается — не сбрасываем в ready,
          // ждём launch:close. 'done' тут лишь убирает полосу прогресса.
          setStatus(s => (s === 'running' || s === 'launching') ? s : 'ready')
        }, 1200)
        return
      }
      if (d.phase === 'error') {
        if (clearTimer.current) clearTimeout(clearTimer.current)
        clearTimer.current = setTimeout(() => setProgress(null), 3000)
        setStatus('ready')
        return
      }
      if (d.phase === 'cancelled') {
        if (clearTimer.current) clearTimeout(clearTimer.current)
        setProgress({ ...EMPTY_PROGRESS, message: 'Отменено' })
        clearTimer.current = setTimeout(() => setProgress(null), 2000)
        checkStatus()
        return
      }

      // Сливаем поля: 'progress' даёт счётчик файлов, 'download-status' — байты.
      // Они приходят разными событиями и не должны перетирать друг друга.
      setProgress(prev => {
        const base = prev ?? EMPTY_PROGRESS
        const next: ProgressState = { ...base }
        if (d.message !== undefined && d.message !== '') next.message = d.message
        if (d.current !== undefined || d.total !== undefined) {
          next.countCurrent = d.current ?? 0
          next.countTotal = d.total ?? 0
        }
        if (d.bytesDownloaded !== undefined || d.bytesTotal !== undefined) {
          next.bytesDownloaded = d.bytesDownloaded ?? 0
          next.bytesTotal = d.bytesTotal ?? 0
        }
        next.speedBps = d.speedBps ?? (d.bytesDownloaded !== undefined ? 0 : base.speedBps)
        return next
      })
    })

    const offClose = window.api.launch.onClose(() => {
      setStatus('ready')
      setProgress(null)
    })

    const offError = window.api.launch.onError((msg: string) => {
      setProgress({ ...EMPTY_PROGRESS, message: msg })
      if (clearTimer.current) clearTimeout(clearTimer.current)
      clearTimer.current = setTimeout(() => setProgress(null), 4000)
      setStatus('ready')
    })

    return () => { offProgress(); offClose(); offError() }
  }, [modpack.id, checkStatus])

  useEffect(() => {
    window.api.store.get('allocatedMemory').then(v => { if (v) setMemory(v as number) })
    window.api.system.totalMemoryMb().then(mb => setTotalRamMb(mb)).catch(() => {})
    window.api.busyGet().then(setBusyId).catch(() => {})
    return window.api.onBusyChanged(setBusyId)
  }, [])

  // Пока игра запущена — следим, не закрылась ли она (актуально после перезапуска лаунчера)
  useEffect(() => {
    if (status !== 'running') return
    const t = setInterval(async () => {
      const id = await window.api.gameRunning().catch(() => null)
      if (id !== modpack.id) checkStatus()
    }, 5000)
    return () => clearInterval(t)
  }, [status, modpack.id, checkStatus])

  // Не даём выбрать больше, чем есть в системе (оставляем запас под ОС).
  const memoryOptions = MEMORY_OPTIONS.filter(mb => mb <= totalRamMb - 1024)
  const safeOptions = memoryOptions.length ? memoryOptions : [2048]

  // Если сохранённое значение больше доступного — подгоняем к максимуму.
  useEffect(() => {
    const max = safeOptions[safeOptions.length - 1]
    if (memory > max) handleMemoryChange(max)
  }, [totalRamMb])

  const handleMemoryChange = async (v: number) => {
    setMemory(v)
    await window.api.store.set('allocatedMemory', v)
  }

  const handleAction = async () => {
    if (busyId && busyId !== modpack.id) return
    if (status === 'ready') {
      const account = await window.api.store.get('activeAccountId') as string | null
      if (!account) {
        setProgress({ ...EMPTY_PROGRESS, message: 'Выберите аккаунт перед запуском' })
        if (clearTimer.current) clearTimeout(clearTimer.current)
        clearTimer.current = setTimeout(() => setProgress(null), 3000)
        return
      }
    }
    if (status === 'not_installed' || status === 'outdated') {
      setStatus('installing')
      setProgress({ ...EMPTY_PROGRESS, message: 'Подготовка...' })
      try {
        await window.api.install.modpack(modpack.id)
        // статус выставит событие 'done' или 'cancelled'
      } catch {
        setStatus('not_installed')
      }
    } else if (status === 'ready') {
      setStatus('launching')
      setProgress({ ...EMPTY_PROGRESS, message: 'Подготовка к запуску...' })
      try {
        const ok = await window.api.launch.start(modpack.id)
        // ok === false при отмене — статус выставит 'cancelled'
        if (ok) setStatus('running')
      } catch {
        setStatus('ready')
      }
    }
  }

  const handleCancel = async () => {
    if (status === 'running') await window.api.killGame()
    else await window.api.cancel()
  }

  const isBusy = status === 'checking' || status === 'installing' || status === 'launching'
  const isRunning = status === 'running'
  const canCancel = status === 'installing' || status === 'launching' || status === 'running'
  // Занята ДРУГАЯ сборка — блокируем действия с этой
  const lockedByOther = !!busyId && busyId !== modpack.id

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

  // Полоса: ведём по счётчику файлов, иначе по байтам, иначе индетерминантная
  const hasCount = progress && progress.countTotal > 0
  const hasBytes = progress && progress.bytesTotal > 0
  const barPct = hasCount
    ? (progress!.countCurrent / progress!.countTotal) * 100
    : hasBytes
      ? (progress!.bytesDownloaded / progress!.bytesTotal) * 100
      : 0
  const indeterminate = isBusy && !hasCount && !hasBytes

  // Прогресс на иконке в панели задач
  useEffect(() => {
    if (!isBusy) window.api.taskbarProgress(-1, 'none')
    else if (indeterminate) window.api.taskbarProgress(0, 'indeterminate')
    else window.api.taskbarProgress(Math.min(barPct, 100) / 100, 'normal')
  }, [isBusy, indeterminate, barPct])

  useEffect(() => () => { window.api.taskbarProgress(-1, 'none') }, [])

  return (
    <div className={styles.bar}>
      <div className={styles.progressTrack}>
        {isBusy && (
          indeterminate
            ? <div className={styles.progressIndeterminate} />
            : <div className={styles.progressFill} style={{ width: `${Math.min(barPct, 100)}%` }}>
                <div className={styles.shimmer} />
              </div>
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
            <MemorySelect
              value={memory}
              options={safeOptions}
              disabled={isBusy || isRunning}
              onChange={handleMemoryChange}
            />
          </div>
          <div className={styles.divider} />
          <div className={styles.stat}>
            <span className={styles.statLabel}>МОДОВ АКТИВНО</span>
            <span className={styles.statVal}>{activeMods} из {totalMods}</span>
          </div>
        </div>

        <div className={styles.statusArea}>
          {progress ? (
            <>
              <div className={styles.statusMsg}>
                {progress.message}
                {isBusy && <span className={styles.dots} />}
              </div>
              <div className={styles.statusSub}>
                {hasCount && <span>{progress.countCurrent}/{progress.countTotal} файлов</span>}
                {hasBytes && <span>{formatBytes(progress.bytesDownloaded)} / {formatBytes(progress.bytesTotal)}</span>}
                {progress.speedBps > 0 && <span className={styles.speed}>{formatSpeed(progress.speedBps)}</span>}
                {isBusy && !hasCount && !hasBytes && <span className={styles.working}>идёт работа, не закрывайте окно</span>}
              </div>
            </>
          ) : lockedByOther ? (
            <div className={styles.statusMsg}>Дождитесь завершения работы с другой сборкой</div>
          ) : status === 'checking' ? (
            <div className={styles.statusMsg}>Проверка<span className={styles.dots} /></div>
          ) : null}
        </div>

        {canCancel && (
          <button className={styles.cancelBtn} onClick={handleCancel} title={isRunning ? 'Остановить игру' : 'Отменить'}>
            {isRunning ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            )}
          </button>
        )}

        <button
          className={`${styles.playBtn} ${btnAccent && !lockedByOther ? styles.playBtnAccent : styles.playBtnMuted}`}
          onClick={handleAction}
          disabled={isBusy || isRunning || lockedByOther}
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
