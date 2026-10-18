import { useState, useEffect, useMemo, type DragEvent } from 'react'
import styles from '../styles/Home.module.css'

export interface HomePack {
  id: string
  name: string
  loader: string
  mc_version: string
  for_map?: boolean
  custom?: boolean
  icon?: string // путь к иконке с портала (famworks-builds), если задана
}

interface Props {
  packs: HomePack[]
  onOpen: (id: string) => void
}

const UNCAT = '' // ключ раздела «Без категории» (общий список)

const GridIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" />
  </svg>
)
const ListIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
  </svg>
)

export default function HomeView({ packs, onOpen }: Props): JSX.Element {
  const [mode, setMode] = useState<'tiles' | 'list'>('tiles')
  const [categories, setCategories] = useState<string[]>([])
  const [packCat, setPackCat] = useState<Record<string, string>>({})
  const [icons, setIcons] = useState<Record<string, string>>({})          // локальные id → filename
  const [portalIcons, setPortalIcons] = useState<Record<string, string>>({}) // с портала id → data-URL
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCat, setOverCat] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newCat, setNewCat] = useState('')

  useEffect(() => {
    window.api.packIcon.all().then(setIcons).catch(() => {})
    window.api.store.get('homeView').then(v => { if (v === 'tiles' || v === 'list') setMode(v) }).catch(() => {})
    window.api.store.get('homeCategories').then(c => { if (Array.isArray(c)) setCategories(c as string[]) }).catch(() => {})
    window.api.store.get('homePackCategory').then(m => { if (m && typeof m === 'object') setPackCat(m as Record<string, string>) }).catch(() => {})
  }, [])

  // Иконки официальных сборок с портала (у кого задана). Зависим от стабильного ключа, а не от
  // массива packs (он пересоздаётся каждый рендер), иначе дёргали бы IPC без нужды.
  const iconItems = packs.filter(p => p.icon).map(p => ({ id: p.id, icon: p.icon as string }))
  const iconKey = iconItems.map(i => `${i.id}:${i.icon}`).join('|')
  useEffect(() => {
    if (iconItems.length) window.api.modpacks.portalIcons(iconItems).then(setPortalIcons).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iconKey])

  // Источник картинки карточки: локальная > портал > буква.
  const iconSrc = (id: string): string | undefined => (icons[id] ? `fwbg://icon/${icons[id]}` : portalIcons[id])

  const setViewMode = (m: 'tiles' | 'list'): void => { setMode(m); window.api.store.set('homeView', m).catch(() => {}) }
  const persistCats = (c: string[]): void => { setCategories(c); window.api.store.set('homeCategories', c).catch(() => {}) }
  const persistPackCat = (m: Record<string, string>): void => { setPackCat(m); window.api.store.set('homePackCategory', m).catch(() => {}) }

  // Категория сборки: сохранённая, если она ещё существует; иначе — общий список.
  const catOf = (id: string): string => {
    const c = packCat[id]
    return c && categories.includes(c) ? c : UNCAT
  }

  const groups = useMemo(() => {
    const byCat: Record<string, HomePack[]> = { [UNCAT]: [] }
    for (const c of categories) byCat[c] = []
    for (const p of packs) (byCat[catOf(p.id)] ?? byCat[UNCAT]).push(p)
    return byCat
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packs, categories, packCat])

  const assign = (id: string, cat: string): void => {
    const m = { ...packCat }
    if (cat === UNCAT) delete m[id]; else m[id] = cat
    persistPackCat(m)
  }

  const addCategory = (): void => {
    const name = newCat.trim()
    if (name && !categories.includes(name)) persistCats([...categories, name])
    setNewCat(''); setAdding(false)
  }
  const deleteCategory = (cat: string): void => {
    persistCats(categories.filter(c => c !== cat))
    const m = { ...packCat }
    for (const id of Object.keys(m)) if (m[id] === cat) delete m[id]
    persistPackCat(m)
  }

  const onDropTo = (cat: string) => (e: DragEvent): void => {
    e.preventDefault()
    const id = dragId ?? e.dataTransfer.getData('text/plain')
    if (id) assign(id, cat)
    setDragId(null); setOverCat(null)
  }

  const Card = (p: HomePack): JSX.Element => (
    <div
      key={p.id}
      className={styles.card}
      draggable
      onDragStart={e => { setDragId(p.id); e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move' }}
      onDragEnd={() => { setDragId(null); setOverCat(null) }}
      onClick={() => onOpen(p.id)}
      title="Открыть сборку"
    >
      <div className={styles.cardIcon}>
        {iconSrc(p.id)
          ? <img src={iconSrc(p.id)} alt="" className={styles.cardImg} />
          : <span className={styles.cardLetter}>{(p.name[0] ?? '?').toUpperCase()}</span>}
      </div>
      <div className={styles.cardInfo}>
        <div className={styles.cardName}>{p.name}</div>
        <div className={styles.cardMeta}>
          <span>{p.loader.charAt(0).toUpperCase() + p.loader.slice(1)} · {p.mc_version}</span>
          {p.for_map && <span className={styles.mapBadge}>КАРТА</span>}
        </div>
      </div>
    </div>
  )

  const renderSection = (cat: string, label: string, deletable: boolean): JSX.Element => {
    const list = groups[cat] ?? []
    return (
      <section
        key={cat || '__uncat__'}
        className={`${styles.section} ${overCat === cat ? styles.sectionOver : ''}`}
        onDragOver={e => { if (dragId) { e.preventDefault(); setOverCat(cat) } }}
        onDragLeave={e => { if (e.currentTarget === e.target) setOverCat(null) }}
        onDrop={onDropTo(cat)}
      >
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>{label}</span>
          <span className={styles.sectionCount}>{list.length}</span>
          {deletable && <button className={styles.catDel} onClick={() => deleteCategory(cat)} title="Удалить категорию">✕</button>}
        </div>
        {list.length === 0
          ? <div className={styles.sectionEmpty}>{deletable ? 'Перетащите сюда сборки' : 'Нет сборок'}</div>
          : <div className={mode === 'tiles' ? styles.grid : styles.listView}>{list.map(Card)}</div>}
      </section>
    )
  }

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <div className={styles.badge}>ВСЕ СБОРКИ · {packs.length}</div>
        <h1 className={styles.title}>Главная</h1>
        <p className={styles.desc}>Ваши сборки, официальные и для карт. Перетащите карточку в категорию.</p>
        <div className={styles.controls}>
          {adding ? (
            <input
              autoFocus className={styles.catInput} placeholder="Название категории" value={newCat} maxLength={24}
              onChange={e => setNewCat(e.target.value)}
              onBlur={addCategory}
              onKeyDown={e => { if (e.key === 'Enter') addCategory(); if (e.key === 'Escape') { setAdding(false); setNewCat('') } }}
            />
          ) : (
            <button className={styles.addCat} onClick={() => setAdding(true)}>+ Категория</button>
          )}
          <div className={styles.spacer} />
          <div className={styles.viewToggle}>
            <button className={`${styles.viewBtn} ${mode === 'tiles' ? styles.viewOn : ''}`} onClick={() => setViewMode('tiles')} title="Плитки"><GridIcon /></button>
            <button className={`${styles.viewBtn} ${mode === 'list' ? styles.viewOn : ''}`} onClick={() => setViewMode('list')} title="Список"><ListIcon /></button>
          </div>
        </div>
      </div>

      <div className={styles.content}>
        {packs.length === 0 && <div className={styles.sectionEmpty}>Пока нет сборок</div>}
        {(groups[UNCAT].length > 0 || categories.length === 0) && renderSection(UNCAT, 'Без категории', false)}
        {categories.map(c => renderSection(c, c, true))}
      </div>
    </main>
  )
}
