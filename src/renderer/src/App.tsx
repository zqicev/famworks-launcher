import { useState, useEffect, useCallback } from 'react'
import { LoadedModpack, Modpack } from '../../types/modpack'
import TitleBar from './components/TitleBar'
import TokenSetup from './components/TokenSetup'
import Sidebar from './components/Sidebar'
import Editor from './components/Editor'
import styles from './styles/App.module.css'

const BLANK = (): Modpack => ({
  id: '',
  name: '',
  description: '',
  long_description: '',
  mc_version: '1.21.1',
  loader: 'fabric',
  loader_version: '0.16.5',
  fabric_api_version: '',
  updated_at: new Date().toISOString(),
  changelog: [],
  mods: []
})

export default function App() {
  const [phase, setPhase] = useState<'checking' | 'token' | 'ready'>('checking')
  const [login, setLogin] = useState('')
  const [packs, setPacks] = useState<Record<string, LoadedModpack>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadWorkspace = useCallback(async () => {
    setLoadError(null)
    try {
      const ws = await window.api.ws.load()
      setPacks(ws.packs)
      const ids = Object.keys(ws.packs)
      if (ids.length) setSelectedId(prev => prev && ws.packs[prev] ? prev : ids[0])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    (async () => {
      const token = await window.api.cfg.get('token') as string
      if (!token) { setPhase('token'); return }
      const res = await window.api.cfg.validateToken()
      if (res.ok) {
        setLogin(res.login ?? '')
        await loadWorkspace()
        setPhase('ready')
      } else {
        setPhase('token')
      }
    })()
  }, [loadWorkspace])

  const handleTokenOk = async (loginName: string) => {
    setLogin(loginName)
    await loadWorkspace()
    setPhase('ready')
  }

  const createNew = () => {
    const draft: LoadedModpack = { data: BLANK(), fileSha: null }
    const tempId = `__new_${Date.now()}`
    draft.data.id = ''
    setPacks(p => ({ ...p, [tempId]: draft }))
    setSelectedId(tempId)
  }

  const handleSaved = (oldKey: string, saved: Modpack, fileSha: string) => {
    setPacks(p => {
      const next = { ...p }
      delete next[oldKey]
      next[saved.id] = { data: saved, fileSha }
      return next
    })
    setSelectedId(saved.id)
  }

  const handleDeleted = (key: string) => {
    setPacks(p => {
      const next = { ...p }
      delete next[key]
      return next
    })
    setSelectedId(null)
  }

  const selected = selectedId ? packs[selectedId] : null

  return (
    <div className={styles.root}>
      <TitleBar />
      {phase === 'checking' && (
        <div className={styles.center}><div className={styles.spinner} /></div>
      )}
      {phase === 'token' && <TokenSetup onOk={handleTokenOk} />}
      {phase === 'ready' && (
        <div className={styles.layout}>
          <Sidebar
            packs={packs}
            selectedId={selectedId}
            login={login}
            onSelect={setSelectedId}
            onNew={createNew}
            onRefresh={loadWorkspace}
          />
          <main className={styles.main}>
            {loadError && <div className={styles.error}>{loadError}</div>}
            {selected ? (
              <Editor
                key={selectedId}
                packKey={selectedId!}
                loaded={selected}
                onSaved={handleSaved}
                onDeleted={handleDeleted}
              />
            ) : (
              <div className={styles.empty}>
                <p>Выберите сборку слева или создайте новую</p>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  )
}
