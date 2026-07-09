import { useState, useRef, useEffect, useMemo, useSyncExternalStore } from 'react'
import { getLogLines, getLogVersion, subscribeLog, clearLog, LogLevel } from '../gameLog'
import styles from '../styles/LogsTab.module.css'

type Filter = 'all' | LogLevel
const LABEL: Record<Filter, string> = { all: 'Все', error: 'Ошибки', warn: 'Предупр.', info: 'Инфо' }
const FILTERS: Filter[] = ['all', 'error', 'warn', 'info']

export default function LogsTab({ modpackId }: { modpackId: string }) {
  const version = useSyncExternalStore(subscribeLog, getLogVersion)
  const all = getLogLines(modpackId)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true) // держимся ли у нижнего края

  const counts = useMemo(() => ({
    all: all.length,
    error: all.filter(l => l.level === 'error').length,
    warn: all.filter(l => l.level === 'warn').length,
    info: all.filter(l => l.level === 'info').length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [version, modpackId])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = all.filter(l =>
      (filter === 'all' || l.level === filter) && (!q || l.text.toLowerCase().includes(q))
    )
    return filtered.slice(-1500) // ограничиваем DOM хвостом
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, filter, query, modpackId])

  // Автоскролл вниз, если пользователь у нижнего края
  useEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [shown])

  const onScroll = () => {
    const el = scrollRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className={styles.chips}>
          {FILTERS.map(f => (
            <button
              key={f}
              className={`${styles.chip} ${styles['chip_' + f]} ${filter === f ? styles.chipActive : ''}`}
              onClick={() => setFilter(f)}
            >
              {LABEL[f]}<span className={styles.chipCount}>{counts[f]}</span>
            </button>
          ))}
        </div>
        <input
          className={styles.search}
          placeholder="Поиск в логах…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button className={styles.clearBtn} onClick={() => clearLog(modpackId)} disabled={all.length === 0}>Очистить</button>
      </div>

      <div className={styles.console} ref={scrollRef} onScroll={onScroll}>
        {shown.length === 0 ? (
          <div className={styles.empty}>
            {all.length === 0 ? 'Логи появятся во время запуска игры' : 'Ничего не найдено'}
          </div>
        ) : (
          shown.map(l => <div key={l.id} className={`${styles.line} ${styles['lvl_' + l.level]}`}>{l.text}</div>)
        )}
      </div>
    </div>
  )
}
