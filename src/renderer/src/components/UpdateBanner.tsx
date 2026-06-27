import { useState, useEffect } from 'react'
import styles from '../styles/UpdateBanner.module.css'

type State = 'hidden' | 'downloading' | 'ready'

export default function UpdateBanner() {
  const [state, setState] = useState<State>('hidden')
  const [percent, setPercent] = useState(0)
  const [version, setVersion] = useState('')

  useEffect(() => {
    const offs = [
      window.api.update.onAvailable((info) => {
        setVersion(info.version)
        setState('downloading')
        setPercent(0)
      }),
      window.api.update.onProgress((p) => {
        setState('downloading')
        setPercent(Math.round(p.percent))
      }),
      window.api.update.onDownloaded((info) => {
        setVersion(info.version)
        setState('ready')
      })
      // ошибки автообновления намеренно не показываем — не мешаем работе
    ]
    return () => offs.forEach(off => off())
  }, [])

  if (state === 'hidden') return null

  return (
    <div className={`${styles.banner} ${state === 'ready' ? styles.bannerReady : ''}`}>
      {state === 'downloading' ? (
        <>
          <span className={styles.spinner} />
          <span className={styles.text}>
            Загрузка обновления{version ? ` ${version}` : ''}… {percent}%
          </span>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${percent}%` }} />
          </div>
        </>
      ) : (
        <>
          <span className={styles.dot} />
          <span className={styles.text}>
            Обновление {version} готово к установке
          </span>
          <button className={styles.installBtn} onClick={() => window.api.update.install()}>
            Перезапустить
          </button>
        </>
      )}
    </div>
  )
}
