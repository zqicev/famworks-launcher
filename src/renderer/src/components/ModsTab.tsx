import { useState } from 'react'
import { Modpack, Mod } from '../../../types/modpack'
import ModRow from './ModRow'
import AddModModal from './AddModModal'
import styles from '../styles/ModsTab.module.css'

interface Props {
  modpack: Modpack
  modsDir: string
}

export default function ModsTab({ modpack, modsDir }: Props) {
  const [search, setSearch] = useState('')
  const [disabled, setDisabled] = useState<Set<string>>(new Set())
  const [addOpen, setAddOpen] = useState(false)

  const filtered = modpack.mods.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.category.toLowerCase().includes(search.toLowerCase())
  )

  const enabledCount = modpack.mods.filter(m => !disabled.has(m.id)).length

  const handleToggle = async (mod: Mod, enabled: boolean) => {
    if (mod.required) return
    await window.api.mods.toggle(modsDir, mod.filename, enabled)
    setDisabled(prev => {
      const next = new Set(prev)
      enabled ? next.delete(mod.id) : next.add(mod.id)
      return next
    })
  }

  const handleDelete = async (mod: Mod) => {
    if (mod.required) return
    await window.api.mods.delete(modsDir, mod.filename)
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
          {enabledCount} / {modpack.mods.length} активны
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
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  )
}
