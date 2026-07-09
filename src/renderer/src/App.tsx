import { useState, useEffect, useCallback, useRef } from 'react'
import { ModpackIndex, Modpack } from '../../types/modpack'
import Sidebar from './components/Sidebar'
import MainPanel from './components/MainPanel'
import TitleBar from './components/TitleBar'
import SetupModal from './components/SetupModal'
import SettingsModal from './components/SettingsModal'
import UpdateBanner from './components/UpdateBanner'
import CreateModpackModal from './components/CreateModpackModal'
import ConfirmModal from './components/ConfirmModal'
import { ensureLogCapture } from './gameLog'
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
  const [toast, setToast] = useState<{ text: string; kind: 'info' | 'success' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [devMode, setDevMode] = useState(false)

  const showToast = useCallback((text: string, kind: 'info' | 'success' | 'error') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ text, kind })
    if (kind !== 'info') toastTimer.current = setTimeout(() => setToast(null), 3800) // info висит до завершения
  }, [])

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

  // Захват логов игры для вкладки «Логи» (один раз на всё приложение)
  useEffect(() => { ensureLogCapture() }, [])

  // Импорт по ассоциации файла (двойной клик по .fwpack)
  useEffect(() => {
    return window.api.onModpackImported((res) => {
      if (res.ok && res.modpack) {
        loadCustom()
        setSelectedId(res.modpack.id)
        showToast(`Сборка «${res.modpack.name}» импортирована`, 'success')
      } else if (res.error) {
        showToast(`Ошибка импорта: ${res.error}`, 'error')
      }
    })
  }, [loadCustom, showToast])

  useEffect(() => {
    const init = async () => {
      const path = await window.api.store.get('installPath') as string
      window.api.store.get('devMode').then(v => setDevMode(!!v)).catch(() => {})
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

  const handleImport = async () => {
    showToast('Импорт сборки…', 'info')
    try {
      const res = await window.api.modpacks.import()
      if (res.cancelled) { setToast(null); return }
      if (res.ok && res.modpack) {
        await loadCustom()
        setSelectedId(res.modpack.id)
        showToast(`Сборка «${res.modpack.name}» импортирована`, 'success')
      } else setToast(null)
    } catch (e) {
      showToast(`Ошибка импорта: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }

  const handleExportCustom = async (id: string) => {
    showToast('Экспорт сборки…', 'info')
    try {
      const res = await window.api.modpacks.export(id)
      if (res.cancelled) { setToast(null); return }
      if (res.ok) showToast('Сборка сохранена в файл', 'success')
      else setToast(null)
    } catch (e) {
      showToast(`Ошибка экспорта: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
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
            onImport={handleImport}
            onExportCustom={handleExportCustom}
          />
          <MainPanel
            modpack={modpack}
            installPath={installPath}
            loading={loading}
            error={error}
            devMode={devMode}
          />
          {settingsOpen && (
            <SettingsModal
              installPath={installPath}
              onPathChange={setInstallPath}
              devMode={devMode}
              onDevModeChange={setDevMode}
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
      {toast && (
        <div className={`${styles.toast} ${styles['toast_' + toast.kind]}`}>
          {toast.kind === 'info' && <span className={styles.toastSpinner} />}
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  )
}
