import { useState, useEffect, useRef, useCallback } from 'react'
import { Modpack, Mod } from '../../../types/modpack'
import ModRow from './ModRow'
import styles from '../styles/ModsTab.module.css'

interface Props {
  modpack: Modpack
  modsDir: string
  onCount?: (total: number, active: number) => void
}

interface LocalMod extends Mod {
  _local?: boolean
  _notInstalled?: boolean // заявлен в сборке, но файла ещё нет на диске (скачается при установке)
}

export default function ModsTab({ modpack, modsDir, onCount }: Props) {
  const [search, setSearch] = useState('')
  const [disabled, setDisabled] = useState<Set<string>>(new Set())
  const [extraMods, setExtraMods] = useState<LocalMod[]>([])
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set())
  const [presentBases, setPresentBases] = useState<Set<string> | null>(null)
  const [dragging, setDragging] = useState(false)
  const scanRef = useRef(false)

  const scanMods = async () => {
    if (scanRef.current) return
    scanRef.current = true
    try {
      const files = await window.api.mods.installed(modsDir) as string[]
      const knownFilenames = new Set(modpack.mods.map(m => m.filename))
      const newDisabled = new Set<string>()

      // Инициализируем disabled из реальных .disabled файлов
      for (const mod of modpack.mods) {
        const disabledFile = mod.filename + '.disabled'
        if (files.includes(disabledFile)) newDisabled.add(mod.id)
      }

      // Локальные моды (не в JSON)
      const extra: LocalMod[] = []
      const seen = new Set<string>()
      for (const f of files) {
        const isDisabled = f.endsWith('.jar.disabled')
        const baseName = isDisabled ? f.replace(/\.disabled$/, '') : f
        if (!baseName.endsWith('.jar')) continue
        if (knownFilenames.has(baseName)) continue
        if (seen.has(baseName)) continue
        seen.add(baseName)

        const id = baseName
        if (isDisabled) newDisabled.add(id)

        const sizeBytes = await window.api.mods.fileSize(modsDir, baseName) as number
        extra.push({
          id,
          name: baseName.replace(/\.jar$/, ''),
          filename: baseName,
          version: '',
          category: 'Локальный',
          size_mb: Math.round(sizeBytes / 1024 / 1024 * 10) / 10,
          required: false,
          _local: true
        })
      }

      // Реально присутствующие на диске базовые имена .jar (для счёта по факту)
      setPresentBases(new Set(files.map(f => f.replace(/\.disabled$/, ''))))
      setDisabled(newDisabled)
      setExtraMods(extra)
    } finally {
      scanRef.current = false
    }
  }

  useEffect(() => {
    scanMods()
    const off = window.api.install.onProgress((raw: unknown) => {
      const d = raw as { phase: string }
      if (d.phase === 'done') setTimeout(scanMods, 300)
    })
    return off
  }, [modsDir])

  // Показываем все заявленные моды сборки сразу (в т.ч. до установки); ещё не скачанные помечаем.
  const packMods: LocalMod[] = modpack.mods.map(m => ({
    ...m,
    _notInstalled: presentBases ? !presentBases.has(m.filename) : false
  }))
  const allMods: LocalMod[] = [...packMods, ...extraMods].filter(m => !deletedIds.has(m.id))
  const enabledCount = allMods.filter(m => !disabled.has(m.id)).length

  // Отдаём родителю фактическое число модов и сколько из них включено
  useEffect(() => {
    onCount?.(allMods.length, enabledCount)
  }, [allMods.length, enabledCount])

  const filtered = allMods.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.category.toLowerCase().includes(search.toLowerCase())
  )

  const handleToggle = async (mod: LocalMod, enabled: boolean) => {
    if (mod.required || mod._notInstalled) return
    await window.api.mods.toggle(modsDir, mod.filename, enabled)
    setDisabled(prev => {
      const next = new Set(prev)
      enabled ? next.delete(mod.id) : next.add(mod.id)
      return next
    })
  }

  const handleDelete = async (mod: LocalMod) => {
    if (mod.required || mod._notInstalled) return
    await window.api.mods.delete(modsDir, mod.filename)
    setDeletedIds(prev => new Set(prev).add(mod.id))
    setExtraMods(prev => prev.filter(m => m.id !== mod.id))
  }

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.jar'))
    for (const file of files) {
      const path = window.api.getPathForFile(file)
      if (path) await window.api.mods.copyJar(path, modsDir)
    }
    if (files.length) setTimeout(scanMods, 300)
  }, [modsDir])

  const openFolder = () => window.api.shell.openFolder(modsDir)

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
          <input
            className={styles.search}
            placeholder="Поиск модов"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <span className={styles.activeCount}>
          {enabledCount} / {allMods.length} активны
        </span>
        <button className={styles.folderBtn} onClick={openFolder} title="Открыть папку модов">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
          </svg>
        </button>
      </div>

      <div className={styles.list}>
        {filtered.map(mod => (
          <ModRow
            key={mod.id}
            mod={mod}
            enabled={!disabled.has(mod.id)}
            notInstalled={mod._notInstalled}
            onToggle={(v) => handleToggle(mod, v)}
            onDelete={() => handleDelete(mod)}
          />
        ))}
      </div>
    </div>
  )
}
