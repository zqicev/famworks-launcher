import { useState, useEffect, useCallback } from 'react'
import { Modpack, Mod } from '../../../types/modpack'
import ModRow from './ModRow'
import styles from '../styles/ModsTab.module.css'

interface Props {
  modpack: Modpack
  gameRoot: string
}

export default function ResourcepacksTab({ modpack, gameRoot }: Props) {
  const [search, setSearch] = useState('')
  const [present, setPresent] = useState<Set<string>>(new Set())
  const [enabled, setEnabled] = useState<Set<string>>(new Set())
  const [extra, setExtra] = useState<Mod[]>([])
  const [dragging, setDragging] = useState(false)

  const scan = useCallback(async () => {
    const files = await window.api.rp.installed(gameRoot).catch(() => [] as string[])
    const en = await window.api.rp.enabled(gameRoot).catch(() => [] as string[])
    setPresent(new Set(files))
    setEnabled(new Set(en))
    const known = new Set((modpack.resourcepacks ?? []).map(p => p.filename))
    setExtra(files.filter(f => !known.has(f)).map(f => ({
      id: f, name: f.replace(/\.zip$/i, ''), filename: f, version: '', category: 'Локальный', size_mb: 0, required: false
    })))
  }, [gameRoot, modpack.resourcepacks])

  useEffect(() => { scan() }, [scan])

  const packMods = (modpack.resourcepacks ?? []).filter(p => present.has(p.filename))
  const all = [...packMods, ...extra]
  const filtered = all.filter(m => m.name.toLowerCase().includes(search.toLowerCase()))

  const handleToggle = async (p: Mod, on: boolean) => {
    if (p.required) return
    await window.api.rp.toggle(gameRoot, p.filename, on)
    setEnabled(prev => { const n = new Set(prev); on ? n.add(p.filename) : n.delete(p.filename); return n })
  }
  const handleDelete = async (p: Mod) => {
    if (p.required) return
    await window.api.rp.delete(gameRoot, p.filename)
    scan()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.zip'))
    for (const f of files) await window.api.mods.copyJar((f as any).path, `${gameRoot}/resourcepacks`)
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
          <input className={styles.search} placeholder="Поиск ресурспаков" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <span className={styles.activeCount}>{all.length} паков · перетащите .zip сюда</span>
        <button className={styles.folderBtn} onClick={() => window.api.shell.openFolder(`${gameRoot}/resourcepacks`)} title="Открыть папку">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
          </svg>
        </button>
      </div>
      <div className={styles.list}>
        {all.length === 0 && <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>Ресурспаков нет</div>}
        {filtered.map(p => (
          <ModRow key={p.id} mod={p} enabled={enabled.has(p.filename)} onToggle={v => handleToggle(p, v)} onDelete={() => handleDelete(p)} />
        ))}
      </div>
    </div>
  )
}
