import { useState } from 'react'
import { LoadedModpack } from '../../../types/modpack'
import CfKeyModal from './CfKeyModal'
import styles from '../styles/Sidebar.module.css'

interface Props {
  packs: Record<string, LoadedModpack>
  selectedId: string | null
  login: string
  onSelect: (key: string) => void
  onNew: () => void
  onRefresh: () => void
}

export default function Sidebar({ packs, selectedId, login, onSelect, onNew, onRefresh }: Props) {
  const keys = Object.keys(packs)
  const [cfOpen, setCfOpen] = useState(false)

  return (
    <aside className={styles.sidebar}>
      {cfOpen && <CfKeyModal onClose={() => setCfOpen(false)} />}
      <div className={styles.header}>
        <span className={styles.title}>СБОРКИ</span>
        <div className={styles.headerBtns}>
          <button className={styles.iconBtn} onClick={() => setCfOpen(true)} title="Ключ CurseForge">⚙</button>
          <button className={styles.iconBtn} onClick={onRefresh} title="Перезагрузить из GitHub">↻</button>
          <button className={styles.newBtn} onClick={onNew}>+ Новая</button>
        </div>
      </div>

      <div className={styles.list}>
        {keys.length === 0 && <div className={styles.empty}>Пока пусто</div>}
        {keys.map(key => {
          const p = packs[key]
          const isNew = p.fileSha === null
          return (
            <button
              key={key}
              className={`${styles.item} ${selectedId === key ? styles.active : ''}`}
              onClick={() => onSelect(key)}
            >
              <div className={styles.avatar}>{(p.data.name || '?')[0].toUpperCase()}</div>
              <div className={styles.info}>
                <div className={styles.name}>
                  {p.data.name || 'Без названия'}
                  {isNew && <span className={styles.newTag}>НЕ СОХР.</span>}
                </div>
                <div className={styles.meta}>
                  {p.data.loader} · {p.data.mc_version} · {p.data.mods.length} модов
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className={styles.account}>
        <div className={styles.avatarSm}>{(login || '?')[0].toUpperCase()}</div>
        <div className={styles.accInfo}>
          <div className={styles.accName}>{login || '—'}</div>
          <div className={styles.accSub}>GitHub</div>
        </div>
      </div>
    </aside>
  )
}
