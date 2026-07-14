import { useState, useEffect, useCallback } from 'react'
import { Mod } from '../../../types/modpack'
import ModRow from './ModRow'
import styles from '../styles/ModsTab.module.css'

interface Props {
  dir: string                       // папка resourcepacks/ или shaderpacks/
  items: Mod[]                      // modpack.resourcepacks / modpack.shaders
  noun: string                      // "ресурспаков" / "шейдеров"
  onCount?: (n: number) => void
}

export default function PackTab({ dir, items, noun, onCount }: Props) {
  const [search, setSearch] = useState('')
  const [present, setPresent] = useState<Set<string>>(new Set())
  const [sizes, setSizes] = useState<Record<string, number>>({})
  const [disabled, setDisabled] = useState<Set<string>>(new Set())
  const [extra, setExtra] = useState<Mod[]>([])
  const [deleted, setDeleted] = useState<Set<string>>(new Set())
  const [dragging, setDragging] = useState(false)

  const scan = useCallback(async () => {
    const files = await window.api.mods.installed(dir).catch(() => [] as string[])
    setPresent(new Set(files.map(f => f.replace(/\.disabled$/, ''))))
    const dis = new Set<string>()
    const known = new Set(items.map(p => p.filename))
    const seen = new Set<string>()
    const ex: Mod[] = []
    for (const f of files) {
      const isDis = f.endsWith('.disabled')
      const base = f.replace(/\.disabled$/, '')
      if (!base.toLowerCase().endsWith('.zip')) continue
      if (isDis) dis.add(base)
      if (known.has(base) || seen.has(base)) continue
      seen.add(base)
      ex.push({ id: base, name: base.replace(/\.zip$/i, ''), filename: base, version: '', category: 'Локальный', size_mb: 0, required: false })
    }
    const sz: Record<string, number> = {}
    for (const base of new Set(files.map(f => f.replace(/\.disabled$/, '')))) {
      if (!base.toLowerCase().endsWith('.zip')) continue
      const bytes = await window.api.mods.fileSize(dir, base).catch(() => 0) as number
      sz[base] = Math.round(bytes / 1024 / 1024 * 10) / 10
    }
    setSizes(sz)
    setDisabled(dis)
    setExtra(ex)
  }, [dir, items])

  useEffect(() => {
    scan()
    const off = window.api.install.onProgress((raw: unknown) => {
      const d = raw as { phase: string }
      if (d.phase === 'done') setTimeout(scan, 300)
    })
    return off
  }, [scan])

  const packItems = items.filter(p => present.has(p.filename))
  const all = [...packItems, ...extra]
    .filter(p => !deleted.has(p.id))
    .map(p => ({ ...p, size_mb: sizes[p.filename] ?? p.size_mb }))
  const filtered = all.filter(m => m.name.toLowerCase().includes(search.toLowerCase()))
  const enabledCount = all.filter(p => !disabled.has(p.filename)).length

  useEffect(() => { onCount?.(all.length) }, [all.length])

  const handleToggle = async (p: Mod, on: boolean) => {
    if (p.required) return
    await window.api.mods.toggle(dir, p.filename, on)
    setDisabled(prev => { const n = new Set(prev); on ? n.delete(p.filename) : n.add(p.filename); return n })
  }
  const handleDelete = async (p: Mod) => {
    if (p.required) return
    await window.api.mods.delete(dir, p.filename)
    setDeleted(prev => new Set(prev).add(p.id))
    setExtra(prev => prev.filter(x => x.id !== p.id))
  }
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.zip'))
    for (const f of files) {
      const path = window.api.getPathForFile(f)
      if (path) await window.api.mods.copyJar(path, dir)
    }
    if (files.length) setTimeout(scan, 300)
  }

  return (
    <div
      className={`${styles.wrapper} ${dragging ? styles.dragging : ''}`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}>⌕</span>
          <input className={styles.search} placeholder={`Поиск ${noun}`} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <span className={styles.activeCount}>{enabledCount} / {all.length} активны</span>
        <button className={styles.folderBtn} onClick={() => window.api.shell.openFolder(dir)} title="Открыть папку">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
          </svg>
        </button>
      </div>
      <div className={styles.list}>
        {all.length === 0 && <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>Пусто</div>}
        {filtered.map(p => (
          <ModRow key={p.id} mod={p} enabled={!disabled.has(p.filename)} onToggle={v => handleToggle(p, v)} onDelete={() => handleDelete(p)} />
        ))}
      </div>
    </div>
  )
}
