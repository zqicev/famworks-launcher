import { useState, useEffect, useRef } from 'react'
import { Modpack, Mod } from '../../../types/modpack'
import ModRow from './ModRow'
import AddModModal from './AddModModal'
import styles from '../styles/ModsTab.module.css'

interface Props {
  modpack: Modpack
  modsDir: string
  onExtraCountChange?: (count: number) => void
}

interface LocalMod extends Mod {
  _local?: boolean
}

export default function ModsTab({ modpack, modsDir, onExtraCountChange }: Props) {
  const [search, setSearch] = useState('')
  const [disabled, setDisabled] = useState<Set<string>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [extraMods, setExtraMods] = useState<LocalMod[]>([])
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

        extra.push({
          id,
          name: baseName.replace(/\.jar$/, ''),
          filename: baseName,
          version: '',
          category: 'Локальный',
          size_mb: 0,
          required: false,
          _local: true
        })
      }

      setDisabled(newDisabled)
      setExtraMods(extra)
      onExtraCountChange?.(extra.length)
    } finally {
      scanRef.current = false
    }
  }

  useEffect(() => {
    scanMods()
    window.api.install.onProgress((raw: unknown) => {
      const d = raw as { phase: string }
      if (d.phase === 'done') setTimeout(scanMods, 300)
    })
  }, [modsDir])

  const allMods: LocalMod[] = [...modpack.mods, ...extraMods]

  const filtered = allMods.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.category.toLowerCase().includes(search.toLowerCase())
  )

  const enabledCount = allMods.filter(m => !disabled.has(m.id)).length

  const handleToggle = async (mod: LocalMod, enabled: boolean) => {
    if (mod.required) return
    await window.api.mods.toggle(modsDir, mod.filename, enabled)
    setDisabled(prev => {
      const next = new Set(prev)
      enabled ? next.delete(mod.id) : next.add(mod.id)
      return next
    })
  }

  const handleDelete = async (mod: LocalMod) => {
    if (mod.required) return
    await window.api.mods.delete(modsDir, mod.filename)
    setExtraMods(prev => {
      const next = prev.filter(m => m.id !== mod.id)
      onExtraCountChange?.(next.length)
      return next
    })
  }

  const handleAddClose = () => {
    setAddOpen(false)
    setTimeout(scanMods, 600)
  }

  return (
    <div className={styles.wrapper}>
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
        <button className={styles.addBtn} onClick={() => setAddOpen(true)}>
          + ДОБАВИТЬ МОД
        </button>
      </div>

      <div className={styles.list}>
        {filtered.map(mod => (
          <ModRow
            key={mod.id}
            mod={mod}
            enabled={!disabled.has(mod.id)}
            onToggle={(v) => handleToggle(mod, v)}
            onDelete={() => handleDelete(mod)}
          />
        ))}
      </div>

      {addOpen && (
        <AddModModal
          modpack={modpack}
          modsDir={modsDir}
          onClose={handleAddClose}
        />
      )}
    </div>
  )
}
