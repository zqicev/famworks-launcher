import { useState, useEffect, useCallback, useRef } from 'react'
import { Modpack } from '../../../types/modpack'
import MemorySelect from './MemorySelect'
import LaunchAccountModal from './LaunchAccountModal'
import { formatBytes, formatSpeed } from '../lib/format'
import styles from '../styles/BottomBar.module.css'

// Базовые варианты ОЗУ (МБ); реальные опции фильтруются по объёму системы
const MEMORY_OPTIONS = [2048, 4096, 6144, 8192, 12288, 16384, 24576, 32768]

interface Props {
  modpack: Modpack
  installPath: string
  activeMods?: number
  totalMods?: number
}

// Статус — только про установку/подготовку. «Запущено» больше не статус: выводится из списка экземпляров.
type ModpackStatus = 'checking' | 'not_installed' | 'outdated' | 'ready' | 'installing' | 'launching'

interface Instance {
  instanceId: string
  modpackId: string
  modpackName: string
  account: string
  startedAt: number
}

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

export default function BottomBar({ modpack, activeMods = 0, totalMods = 0 }: Props) {
  const [status, setStatus] = useState<ModpackStatus>('checking')
  const [memory, setMemory] = useState(4096)
  const [totalRamMb, setTotalRamMb] = useState(16384)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [instances, setInstances] = useState<Instance[]>([])
  const [stopOpen, setStopOpen] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const myInstances = instances.filter(i => i.modpackId === modpack.id)
  const running = myInstances.length > 0

  const refreshInstances = useCallback(() => {
    window.api.gameInstances().then(setInstances).catch(() => {})
  }, [])

  const checkStatus = useCallback(async () => {
    setStatus('checking')
    setProgress(null)
    try {
      setStatus(await window.api.modpacks.status(modpack.id) as ModpackStatus)
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
        clearTimer.current = setTimeout(() => { setProgress(null); setStatus('ready') }, 1200)
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

    const offError = window.api.launch.onError((msg: string) => {
      setProgress({ ...EMPTY_PROGRESS, message: msg })
      if (clearTimer.current) clearTimeout(clearTimer.current)
      clearTimer.current = setTimeout(() => setProgress(null), 4000)
      setStatus('ready')
    })

    const offClose = window.api.launch.onClose(() => refreshInstances())

    return () => { offProgress(); offError(); offClose() }
  }, [modpack.id, checkStatus, refreshInstances])

  // Запущенные экземпляры: начальная загрузка + live-обновление из main.
  useEffect(() => {
    refreshInstances()
    return window.api.onInstancesChanged(refreshInstances)
  }, [refreshInstances])

  // «Осиротевшие» экземпляры (после перезапуска лаунчера) не шлют событий — опрашиваем, пока что-то живо.
  useEffect(() => {
    if (!running) return
    const t = setInterval(refreshInstances, 5000)
    return () => clearInterval(t)
  }, [running, refreshInstances])

  useEffect(() => {
    window.api.system.totalMemoryMb().then(mb => setTotalRamMb(mb)).catch(() => {})
    window.api.busyGet().then(setBusyId).catch(() => {})
    return window.api.onBusyChanged(setBusyId)
  }, [])

  // ОЗУ теперь своё для каждой сборки — перечитываем при смене сборки.
  useEffect(() => {
    window.api.memory.get(modpack.id).then(v => { if (v) setMemory(v) }).catch(() => {})
  }, [modpack.id])

  // Если подготовка началась с этой сборкой извне (например, запуск из Обзора) — отражаем статус.
  useEffect(() => {
    if (busyId === modpack.id) {
      setStatus(s => (s === 'installing' || s === 'launching') ? s : 'launching')
    }
  }, [busyId, modpack.id])

  // Закрытие стоп-меню по клику вне.
  useEffect(() => {
    if (!stopOpen) return
    const close = (): void => setStopOpen(false)
    const t = setTimeout(() => document.addEventListener('click', close), 0)
    return () => { clearTimeout(t); document.removeEventListener('click', close) }
  }, [stopOpen])

  // Не даём выбрать больше, чем есть в системе (оставляем запас под ОС).
  const memoryOptions = MEMORY_OPTIONS.filter(mb => mb <= totalRamMb - 1024)
  const safeOptions = memoryOptions.length ? memoryOptions : [2048]

  useEffect(() => {
    const max = safeOptions[safeOptions.length - 1]
    if (memory > max) handleMemoryChange(max)
  }, [totalRamMb])

  const handleMemoryChange = async (v: number) => {
    setMemory(v)
    await window.api.memory.set(modpack.id, v)
  }

  const noAccountWarn = async (): Promise<boolean> => {
    const account = await window.api.store.get('activeAccountId') as string | null
    if (!account) {
      setProgress({ ...EMPTY_PROGRESS, message: 'Выберите аккаунт перед запуском' })
      if (clearTimer.current) clearTimeout(clearTimer.current)
      clearTimer.current = setTimeout(() => setProgress(null), 3000)
      return true
    }
    return false
  }

  const handleAction = async () => {
    if (busyId && busyId !== modpack.id) return
    if (status === 'not_installed' || status === 'outdated') {
      setStatus('installing')
      setProgress({ ...EMPTY_PROGRESS, message: 'Подготовка...' })
      try { await window.api.install.modpack(modpack.id) } catch { setStatus('not_installed') }
    } else if (status === 'ready') {
      if (await noAccountWarn()) return
      setStatus('launching')
      setProgress({ ...EMPTY_PROGRESS, message: 'Подготовка к запуску...' })
      try {
        await window.api.launch.start(modpack.id)
        refreshInstances()
      } catch { setStatus('ready') }
    }
  }

  // Запуск ещё одного экземпляра под выбранным аккаунтом (из окна LaunchAccountModal).
  const launchWith = async (accountId: string) => {
    setPickOpen(false)
    setStatus('launching')
    setProgress({ ...EMPTY_PROGRESS, message: 'Подготовка к запуску...' })
    try {
      await window.api.launch.start(modpack.id, undefined, accountId)
      refreshInstances()
    } catch { setStatus('ready') }
  }

  const stopInstance = async (instanceId: string) => {
    setStopOpen(false)
    await window.api.killGame(instanceId).catch(() => {})
    refreshInstances()
  }
  const handleStop = () => {
    if (myInstances.length <= 1) { if (myInstances[0]) stopInstance(myInstances[0].instanceId) }
    else setStopOpen(o => !o)
  }

  const isBusy = status === 'checking' || status === 'installing' || status === 'launching'
  const canCancel = status === 'installing' || status === 'launching'
  const lockedByOther = !!busyId && busyId !== modpack.id

  const btnLabel = {
    checking: 'ПРОВЕРКА...', not_installed: 'УСТАНОВИТЬ', outdated: 'ОБНОВИТЬ',
    ready: 'ИГРАТЬ', installing: 'УСТАНОВКА...', launching: 'ЗАПУСК...'
  }[status]
  const btnAccent = status === 'not_installed' || status === 'outdated' || status === 'ready'

  const hasCount = progress && progress.countTotal > 0
  const hasBytes = progress && progress.bytesTotal > 0
  const barPct = hasCount
    ? (progress!.countCurrent / progress!.countTotal) * 100
    : hasBytes ? (progress!.bytesDownloaded / progress!.bytesTotal) * 100 : 0
  const indeterminate = isBusy && !hasCount && !hasBytes

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
            <MemorySelect value={memory} options={safeOptions} disabled={isBusy} onChange={handleMemoryChange} />
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
              <div className={styles.statusMsg}>{progress.message}{isBusy && <span className={styles.dots} />}</div>
              <div className={styles.statusSub}>
                {hasCount && <span>{progress.countCurrent}/{progress.countTotal} файлов</span>}
                {hasBytes && <span>{formatBytes(progress.bytesDownloaded)} / {formatBytes(progress.bytesTotal)}</span>}
                {progress.speedBps > 0 && <span className={styles.speed}>{formatSpeed(progress.speedBps)}</span>}
                {isBusy && !hasCount && !hasBytes && <span className={styles.working}>идёт работа, не закрывайте окно</span>}
              </div>
            </>
          ) : lockedByOther ? (
            <div className={styles.statusMsg}>Дождитесь завершения работы с другой сборкой</div>
          ) : running ? (
            <div className={styles.statusMsg}>Запущено экземпляров: {myInstances.length}</div>
          ) : status === 'checking' ? (
            <div className={styles.statusMsg}>Проверка<span className={styles.dots} /></div>
          ) : null}
        </div>

        {isBusy ? (
          <>
            {canCancel && (
              <button className={styles.cancelBtn} onClick={() => window.api.cancel()} title="Отменить">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
            <button className={`${styles.playBtn} ${btnAccent ? styles.playBtnAccent : styles.playBtnMuted}`} disabled>
              <span className={styles.playLabel}>{btnLabel}</span>
              <span className={styles.playSub}>{modpack.name} · {modpack.mc_version}</span>
            </button>
          </>
        ) : running ? (
          <>
            <div className={styles.stopWrap}>
              <button className={styles.cancelBtn} onClick={handleStop} title="Остановить">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
              </button>
              {stopOpen && myInstances.length > 1 && (
                <div className={styles.stopMenu} onClick={e => e.stopPropagation()}>
                  <div className={styles.stopMenuHead}>Остановить экземпляр</div>
                  {myInstances.map((inst, i) => (
                    <button key={inst.instanceId} className={styles.stopMenuItem} onClick={() => stopInstance(inst.instanceId)}>
                      #{i + 1} · {inst.account}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className={styles.playGroup}>
              <button className={`${styles.playBtn} ${styles.playBtnMuted}`} disabled>
                <span className={styles.playLabel}>ИГРАТЬ</span>
                <span className={styles.playSub}>{myInstances.length} запущено · {modpack.name}</span>
              </button>
              <div className={styles.playSep} />
              <button className={styles.playPlus} onClick={() => !lockedByOther && setPickOpen(true)} disabled={lockedByOther} title="Запустить ещё экземпляр">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>
          </>
        ) : (
          <button
            className={`${styles.playBtn} ${btnAccent && !lockedByOther ? styles.playBtnAccent : styles.playBtnMuted}`}
            onClick={handleAction}
            disabled={lockedByOther}
          >
            <span className={styles.playLabel}>
              {status === 'ready' && <span className={styles.playIcon}>▶ </span>}
              {btnLabel}
            </span>
            <span className={styles.playSub}>{modpack.name} · {modpack.mc_version}</span>
          </button>
        )}
      </div>

      {pickOpen && <LaunchAccountModal memoryMb={memory} onPick={launchWith} onClose={() => setPickOpen(false)} />}
    </div>
  )
}
