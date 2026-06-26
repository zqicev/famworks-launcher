import { useState, useEffect } from 'react'
import { ModpackIndex, Modpack } from '../../types/modpack'
import Sidebar from './components/Sidebar'
import MainPanel from './components/MainPanel'
import TitleBar from './components/TitleBar'
import SetupModal from './components/SetupModal'
import SettingsModal from './components/SettingsModal'
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

  useEffect(() => {
    const init = async () => {
      try {
        const path = await window.api.store.get('installPath')
        if (!path) {
          setNeedsSetup(true)
          setLoading(false)
          return
        }
        setInstallPath(path)

        const index = await window.api.modpacks.index()
        setModpackIndex(index)

        if (index.modpacks.length > 0) {
          setSelectedId(index.modpacks[0].id)
        }
      } catch (e) {
        setError('Не удалось загрузить список сборок. Проверьте интернет-соединение.')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (!selectedId) return
    setModpack(null)
    window.api.modpacks.get(selectedId).then(setModpack).catch(() => {
      setError('Не удалось загрузить сборку.')
    })
  }, [selectedId])

  const handleSetupComplete = async (path: string) => {
    await window.api.store.set('installPath', path)
    setInstallPath(path)
    setNeedsSetup(false)
    setLoading(true)
    try {
      const index = await window.api.modpacks.index()
      setModpackIndex(index)
      if (index.modpacks.length > 0) setSelectedId(index.modpacks[0].id)
    } catch {
      setError('Не удалось загрузить список сборок.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.root}>
      <TitleBar />
      {needsSetup ? (
        <SetupModal onComplete={handleSetupComplete} />
      ) : (
        <div className={styles.layout}>
          <Sidebar
            index={modpackIndex}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onSettings={() => setSettingsOpen(true)}
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
        </div>
      )}
    </div>
  )
}
