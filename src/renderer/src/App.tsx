import { useState, useEffect, useCallback } from 'react'
import { ModpackIndex, Modpack } from '../../types/modpack'
import Sidebar from './components/Sidebar'
import MainPanel from './components/MainPanel'
import TitleBar from './components/TitleBar'
import SetupModal from './components/SetupModal'
import SettingsModal from './components/SettingsModal'
import UpdateBanner from './components/UpdateBanner'
import CreateModpackModal from './components/CreateModpackModal'
import ConfirmModal from './components/ConfirmModal'
import styles from './styles/App.module.css'

export default function App() {
  const [modpackIndex, setModpackIndex] = useState<ModpackIndex | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [modpack, setModpack] = useState<Modpack | null>(null)
  const [installPath, setInstallPath] = useState<string>('')
  const [needsSetup, setNeedsSetup] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [seenUpdates, setSeenUpdates] = useState<Record<string, string>>({})
  const [customPacks, setCustomPacks] = useState<Modpack[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Modpack | null>(null)

  const loadCustom = useCallback(async () => {
    setCustomPacks(await window.api.custom.list().catch(() => []))
  }, [])

  const loadIndex = useCallback(async () => {
    setError(null)
    try {
      const index = await window.api.modpacks.index()
      setModpackIndex(index)

      // Запоминаем updated_at для индикатора обновлений
      const stored = await window.api.store.get('seenUpdates') as Record<string, string> | null ?? {}
      const next = { ...stored }
      let changed = false
      for (const pack of index.modpacks) {
        if (!next[pack.id]) { next[pack.id] = pack.updated_at; changed = true }
      }
      if (changed) await window.api.store.set('seenUpdates', next)
      setSeenUpdates(next)

      if (!selectedId && index.modpacks.length > 0) {
        setSelectedId(index.modpacks[0].id)
      }
    } catch (e) {
      const reason = e instanceof Error && e.message ? ` (${e.message})` : ''
      setError(`Не удалось загрузить список сборок. Проверьте интернет-соединение.${reason}`)
    }
  }, [selectedId])

  useEffect(() => {
    const init = async () => {
      const path = await window.api.store.get('installPath') as string
      if (!path) { setNeedsSetup(true); setLoading(false); return }
      setInstallPath(path)
      await Promise.all([loadIndex(), loadCustom()])
      setLoading(false)
    }
    init()
  }, [])

  useEffect(() => {
    if (!selectedId) return
    setModpack(null)
    window.api.modpacks.get(selectedId).then(mp => {
      setModpack(mp)
      // Обновляем seen после открытия сборки
      window.api.store.get('seenUpdates').then(stored => {
        const s = (stored as Record<string, string>) ?? {}
        const next = { ...s, [mp.id]: mp.updated_at }
        window.api.store.set('seenUpdates', next)
        setSeenUpdates(next)
      })
    }).catch(() => setError('Не удалось загрузить сборку.'))
  }, [selectedId])

  const handleSetupComplete = async (path: string) => {
    await window.api.store.set('installPath', path)
    setInstallPath(path)
    setNeedsSetup(false)
    setLoading(true)
    await loadIndex()
    setLoading(false)
  }

  const handleRefresh = async () => {
    setLoading(true)
    await Promise.all([loadIndex(), loadCustom()])
    if (selectedId) {
      const mp = await window.api.modpacks.get(selectedId).catch(() => null)
      if (mp) setModpack(mp)
    }
    setLoading(false)
  }

  const handleCreated = async (mp: Modpack) => {
    await window.api.custom.save(mp)
    await loadCustom()
    setCreateOpen(false)
    setSelectedId(mp.id)
  }

  const handleDeleteCustom = (id: string) => {
    setDeleteTarget(customPacks.find(p => p.id === id) ?? null)
  }

  const confirmDeleteCustom = async () => {
    if (!deleteTarget) return
    const id = deleteTarget.id
    await window.api.custom.delete(id, true)
    await loadCustom()
    if (selectedId === id) setSelectedId(modpackIndex?.modpacks[0]?.id ?? null)
    setDeleteTarget(null)
  }

  return (
    <div className={styles.root}>
      <TitleBar />
      <UpdateBanner />
      {needsSetup ? (
        <SetupModal onComplete={handleSetupComplete} />
      ) : (
        <div className={styles.layout}>
          <Sidebar
            index={modpackIndex}
            customPacks={customPacks}
            selectedId={selectedId}
            seenUpdates={seenUpdates}
            onSelect={setSelectedId}
            onSettings={() => setSettingsOpen(true)}
            onRefresh={handleRefresh}
            onCreate={() => setCreateOpen(true)}
            onDeleteCustom={handleDeleteCustom}
          />
          <MainPanel
            modpack={modpack}
            installPath={installPath}
            loading={loading}
            error={error}
          />
          {settingsOpen && (
            <SettingsModal
              installPath={installPath}
              onPathChange={setInstallPath}
              onClose={() => setSettingsOpen(false)}
            />
          )}
          {createOpen && (
            <CreateModpackModal onCreate={handleCreated} onClose={() => setCreateOpen(false)} />
          )}
          {deleteTarget && (
            <ConfirmModal
              title="Удалить сборку?"
              message={`«${deleteTarget.name}» и все её файлы (моды, ресурспаки, шейдеры, миры, настройки, Minecraft) будут удалены с диска без возможности восстановления.`}
              danger
              onConfirm={confirmDeleteCustom}
              onClose={() => setDeleteTarget(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}
