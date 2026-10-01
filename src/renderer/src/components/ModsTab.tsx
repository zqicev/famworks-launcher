import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Modpack, Mod } from '../../../types/modpack'
import ModRow from './ModRow'
import { useContentIcons } from '../lib/useContentIcons'
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

// У famworks-мода реальное имя файла — с портала (из трекинга), а не из JSON сборки.
function realFile(mod: Mod, fw: Record<string, { filename: string }>): string {
  return mod.famworks_id ? (fw[mod.famworks_id]?.filename ?? mod.filename) : mod.filename
}

export default function ModsTab({ modpack, modsDir, onCount }: Props) {
  const [search, setSearch] = useState('')
  const [disabled, setDisabled] = useState<Set<string>>(new Set())
  const [extraMods, setExtraMods] = useState<LocalMod[]>([])
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set())
  const [presentBases, setPresentBases] = useState<Set<string> | null>(null)
  const [dragging, setDragging] = useState(false)
  // FamWorks: право тестера (показывать test/release) + выбранные ветки модов этой сборки.
  const [fwTesting, setFwTesting] = useState(false)
  const [fwChannels, setFwChannels] = useState<Record<string, string>>({})
  // Реальные установленные файлы famworks-модов (famworks_id → {filename}). ref — для стабильных обработчиков.
  const [fwInstalled, setFwInstalled] = useState<Record<string, { filename: string }>>({})
  const fwInstalledRef = useRef<Record<string, { filename: string }>>({})
  // Стаггер играет один раз при монтировании вкладки, потом класс снимаем — поиск не дёргает список.
  const [staggerOn, setStaggerOn] = useState(true)
  useEffect(() => { const t = setTimeout(() => setStaggerOn(false), 700); return () => clearTimeout(t) }, [])
  const scanRef = useRef(false)

  const scanMods = async () => {
    if (scanRef.current) return
    scanRef.current = true
    try {
      const files = await window.api.mods.installed(modsDir) as string[]
      const fw = await window.api.famworks.installed(modpack.id).catch(() => ({})) as Record<string, { filename: string }>
      fwInstalledRef.current = fw
      setFwInstalled(fw)
      const knownFilenames = new Set(modpack.mods.map(m => realFile(m, fw)))
      const newDisabled = new Set<string>()

      // Инициализируем disabled из реальных .disabled файлов (famworks — по реальному имени с портала)
      for (const mod of modpack.mods) {
        const disabledFile = realFile(mod, fw) + '.disabled'
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

  // Право тестера и выбранные ветки famworks-модов этой сборки.
  useEffect(() => {
    window.api.famworks.access().then(a => setFwTesting(!!a.paired && !!a.testing)).catch(() => {})
    window.api.store.get('famworksChannels').then(all => {
      setFwChannels((all as Record<string, Record<string, string>> | null)?.[modpack.id] ?? {})
    }).catch(() => {})
  }, [modpack.id])

  // Переключение ветки мода: сохраняем выбор, переустановка на стороне main эмитит 'done' → список пересканируется.
  const handleChannel = useCallback(async (mod: Mod, channel: 'test' | 'release') => {
    const fwid = mod.famworks_id
    if (!fwid) return
    setFwChannels(prev => ({ ...prev, [fwid]: channel }))
    await window.api.famworks.setChannel(modpack.id, fwid, channel).catch(() => {})
  }, [modpack.id])

  // Показываем все заявленные моды сборки сразу (в т.ч. до установки); ещё не скачанные помечаем.
  const packMods = useMemo<LocalMod[]>(() => modpack.mods.map(m => ({
    ...m,
    _notInstalled: presentBases ? !presentBases.has(realFile(m, fwInstalled)) : false
  })), [modpack.mods, presentBases, fwInstalled])

  const allMods = useMemo(
    () => [...packMods, ...extraMods].filter(m => !deletedIds.has(m.id)),
    [packMods, extraMods, deletedIds]
  )
  const enabledCount = allMods.filter(m => !disabled.has(m.id)).length
  const iconFor = useContentIcons(modsDir, allMods, presentBases ?? new Set())

  // Отдаём родителю фактическое число модов и сколько из них включено
  useEffect(() => {
    onCount?.(allMods.length, enabledCount)
  }, [allMods.length, enabledCount])

  const filtered = allMods.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.category.toLowerCase().includes(search.toLowerCase())
  )

  const handleToggle = useCallback(async (mod: Mod, enabled: boolean) => {
    if (mod.required) return
    await window.api.mods.toggle(modsDir, realFile(mod, fwInstalledRef.current), enabled)
    setDisabled(prev => {
      const next = new Set(prev)
      enabled ? next.delete(mod.id) : next.add(mod.id)
      return next
    })
  }, [modsDir])

  const handleDelete = useCallback(async (mod: Mod) => {
    if (mod.required) return
    await window.api.mods.delete(modsDir, realFile(mod, fwInstalledRef.current))
    setDeletedIds(prev => new Set(prev).add(mod.id))
    setExtraMods(prev => prev.filter(m => m.id !== mod.id))
  }, [modsDir])

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
      </div>

      <div className={`${styles.list} ${staggerOn ? 'fw-stagger' : ''}`}>
        {filtered.map(mod => (
          <ModRow
            key={mod.id}
            mod={mod}
            icon={iconFor(mod)}
            enabled={!disabled.has(mod.id)}
            notInstalled={mod._notInstalled}
            channel={fwTesting && mod.famworks_id ? ((fwChannels[mod.famworks_id] as 'test' | 'release') ?? 'release') : undefined}
            onChannel={fwTesting && mod.famworks_id ? handleChannel : undefined}
            onToggle={handleToggle}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  )
}
