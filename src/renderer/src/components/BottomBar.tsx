import { useState } from 'react'
import { Modpack } from '../../../types/modpack'
import styles from '../styles/BottomBar.module.css'

interface Props {
  modpack: Modpack
  installPath: string
}

type LaunchState = 'idle' | 'installing' | 'launching' | 'running'

export default function BottomBar({ modpack, installPath }: Props) {
  const [memory, setMemory] = useState(4096)
  const [state, setState] = useState<LaunchState>('idle')
  const [log, setLog] = useState('')

  const handlePlay = async () => {
    setState('installing')
    setLog('Устанавливаем файлы...')

    window.api.install.onProgress((d: unknown) => {
      const data = d as { done: number; total: number; mod: string }
      setLog(`Загрузка модов: ${data.done}/${data.total} — ${data.mod}`)
    })

    window.api.launch.onLog((msg: string) => setLog(msg))
    window.api.launch.onClose(() => setState('idle'))

    try {
      await window.api.install.modpack(modpack.id)
      setState('launching')
      setLog('Запуск...')
      await window.api.launch.start(modpack.id)
      setState('running')
      setLog('Игра запущена')
    } catch (e) {
      setState('idle')
      setLog(String(e))
    }
  }

  const isRunning = state === 'running'
  const isBusy = state === 'installing' || state === 'launching'

  return (
    <div className={styles.bar}>
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
            onChange={e => setMemory(Number(e.target.value))}
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
          <span className={styles.statVal}>{modpack.mods.length} из {modpack.mods.length}</span>
        </div>
      </div>

      {log ? <div className={styles.log}>{log}</div> : <div className={styles.spacer} />}

      <button
        className={`${styles.playBtn} ${isBusy ? styles.busy : ''} ${isRunning ? styles.running : ''}`}
        onClick={handlePlay}
        disabled={isBusy || isRunning}
      >
        <span className={styles.playLabel}>
          {isBusy ? 'ЗАГРУЗКА...' : isRunning ? 'ЗАПУЩЕНО' : 'ИГРАТЬ'}
        </span>
        {!isBusy && !isRunning && <span className={styles.playIcon}>▶</span>}
        <span className={styles.playSub}>{modpack.name} · {modpack.mc_version}</span>
      </button>
    </div>
  )
}
