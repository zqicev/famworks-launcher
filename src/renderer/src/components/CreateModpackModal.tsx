import { useState, useEffect } from 'react'
import { Modpack } from '../../../types/modpack'
import styles from '../styles/SettingsModal.module.css'

interface Props {
  onCreate: (mp: Modpack) => void
  onClose: () => void
}

export default function CreateModpackModal({ onCreate, onClose }: Props) {
  const [name, setName] = useState('')
  const [mc, setMc] = useState('1.21.1')
  const [loader, setLoader] = useState<'fabric' | 'forge'>('fabric')
  const [loaderVer, setLoaderVer] = useState('')
  const [fabricApi, setFabricApi] = useState('')
  const [busy, setBusy] = useState(false)

  // Подтягиваем последнюю версию Fabric-загрузчика под выбранную версию MC
  useEffect(() => {
    if (loader !== 'fabric') return
    let active = true
    window.api.fabricLoader(mc).then(v => { if (active && v) setLoaderVer(v) })
    return () => { active = false }
  }, [mc, loader])

  const create = async () => {
    if (!name.trim() || !mc.trim() || !loaderVer.trim()) return
    setBusy(true)
    const id = `custom-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`
    const mp: Modpack = {
      id,
      name: name.trim(),
      description: 'Моя сборка',
      long_description: '',
      mc_version: mc.trim(),
      loader,
      loader_version: loaderVer.trim(),
      fabric_api_version: fabricApi.trim(),
      updated_at: new Date().toISOString(),
      changelog: [],
      mods: []
    }
    onCreate(mp)
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Новая сборка</h2>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>
        <div className={styles.body}>
          <Field label="НАЗВАНИЕ">
            <input className={styles.cinput} value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder="Моя сборка" autoFocus />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="ВЕРСИЯ MC">
              <input className={styles.cinput} value={mc} onChange={e => setMc(e.target.value)} placeholder="1.21.1" />
            </Field>
            <Field label="ЗАГРУЗЧИК">
              <select className={styles.cinput} value={loader} onChange={e => setLoader(e.target.value as any)}>
                <option value="fabric">Fabric</option>
                <option value="forge">Forge</option>
              </select>
            </Field>
          </div>
          <Field label="ВЕРСИЯ ЗАГРУЗЧИКА">
            <input className={styles.cinput} value={loaderVer} onChange={e => setLoaderVer(e.target.value)} placeholder="подтянется автоматически" />
          </Field>
          {loader === 'fabric' && (
            <Field label="ВЕРСИЯ FABRIC API (необязательно)">
              <input className={styles.cinput} value={fabricApi} onChange={e => setFabricApi(e.target.value)} placeholder="напр. 0.116.0+1.21.1" />
            </Field>
          )}
          <p className={styles.hint}>Моды, ресурспаки и шейдеры добавишь после создания во вкладках.</p>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Отмена</button>
          <button className={styles.saveBtn} onClick={create} disabled={busy || !name.trim() || !loaderVer.trim()}>Создать</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: 'var(--text-dim)' }}>{label}</label>
      {children}
    </div>
  )
}
