import { useState, useEffect } from 'react'
import { Modpack } from '../../../types/modpack'
import Dropdown from './Dropdown'
import styles from '../styles/SettingsModal.module.css'

interface Props {
  onCreate: (mp: Modpack) => void
  onClose: () => void
}

export default function CreateModpackModal({ onCreate, onClose }: Props) {
  const [name, setName] = useState('')
  const [mc, setMc] = useState('1.21.1')
  const [loader, setLoader] = useState<'fabric' | 'forge' | 'neoforge' | 'quilt' | 'vanilla'>('fabric')
  const [loaderVer, setLoaderVer] = useState('')
  const [fabricApi, setFabricApi] = useState('')
  const [busy, setBusy] = useState(false)
  const [versions, setVersions] = useState<string[]>([])
  const [mcOpen, setMcOpen] = useState(false)
  const [loaderChecking, setLoaderChecking] = useState(false)

  const usesFabricApi = loader === 'fabric' || loader === 'quilt'
  const needsLoaderVer = loader !== 'vanilla' // Vanilla — без загрузчика, версия загрузчика не нужна
  const loaderLabel = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', vanilla: 'Vanilla' }[loader]

  // Список версий MC под выбранный загрузчик (только те, где загрузчик реально есть). Перезагружаем при смене.
  useEffect(() => {
    let active = true
    setVersions([])
    window.api.mcVersions(loader).then(v => { if (active) setVersions(v) }).catch(() => {})
    return () => { active = false }
  }, [loader])

  const mcMatches = versions.filter(v => v.startsWith(mc.trim())).slice(0, 8)
  const mcValid = versions.length === 0 || versions.includes(mc.trim())

  // Подтягиваем последнюю версию выбранного загрузчика под выбранную версию MC.
  // Итог — авторитетная проверка совместимости: пустой ответ = под этот загрузчик такой версии нет.
  useEffect(() => {
    if (!needsLoaderVer) { setLoaderVer(''); setLoaderChecking(false); return }
    let active = true
    setLoaderVer('')
    setLoaderChecking(true)
    window.api.loaderLatest(loader, mc)
      .then(v => { if (active) setLoaderVer(v || '') })
      .catch(() => {})
      .finally(() => { if (active) setLoaderChecking(false) })
    return () => { active = false }
  }, [mc, loader, needsLoaderVer])

  // Версия существует, но под выбранный загрузчик её нет (loaderLatest вернул пусто).
  const loaderMissing = needsLoaderVer && mcValid && !loaderChecking && !!mc.trim() && !loaderVer.trim()

  const create = async () => {
    if (!name.trim() || !mc.trim() || !mcValid || (needsLoaderVer && !loaderVer.trim())) return
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
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`${styles.modal} ${styles.modalOverflow}`} onClick={e => e.stopPropagation()}>
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
              <div style={{ position: 'relative' }}>
                <input
                  className={`${styles.cinput} ${!mcValid && mc.trim() ? styles.cinputBad : ''}`}
                  value={mc}
                  onChange={e => { setMc(e.target.value); setMcOpen(true) }}
                  onFocus={() => setMcOpen(true)}
                  onBlur={() => setMcOpen(false)}
                  placeholder="1.21.1"
                />
                {mcOpen && mcMatches.length > 0 && !(mcMatches.length === 1 && mcMatches[0] === mc.trim()) && (
                  <div className={styles.suggest}>
                    {mcMatches.map(v => (
                      <button key={v} type="button" className={styles.suggestItem}
                        onMouseDown={e => { e.preventDefault(); setMc(v); setMcOpen(false) }}>
                        {v}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>
            <Field label="ЗАГРУЗЧИК">
              <Dropdown
                value={loader}
                onChange={v => setLoader(v as typeof loader)}
                options={[
                  { value: 'fabric', label: 'Fabric' },
                  { value: 'quilt', label: 'Quilt' },
                  { value: 'forge', label: 'Forge' },
                  { value: 'neoforge', label: 'NeoForge' },
                  { value: 'vanilla', label: 'Без загрузчика (Vanilla)' }
                ]}
              />
            </Field>
          </div>
          {needsLoaderVer && (
            <Field label="ВЕРСИЯ ЗАГРУЗЧИКА">
              <input className={`${styles.cinput} ${loaderMissing ? styles.cinputBad : ''}`} value={loaderVer}
                onChange={e => setLoaderVer(e.target.value)}
                placeholder={loaderChecking ? 'проверяем…' : 'подтянется автоматически'} />
            </Field>
          )}
          {usesFabricApi && (
            <Field label="ВЕРСИЯ FABRIC API (необязательно)">
              <input className={styles.cinput} value={fabricApi} onChange={e => setFabricApi(e.target.value)} placeholder="напр. 0.116.0+1.21.1" />
            </Field>
          )}
          {!mcValid && mc.trim() && (
            <p className={styles.hint} style={{ color: 'var(--red)' }}>
              {loader === 'vanilla'
                ? 'Такой версии Minecraft нет — выберите из подсказки.'
                : `Под ${loaderLabel} нет версии для Minecraft ${mc.trim()} - выберите из подсказки.`}
            </p>
          )}
          {loaderMissing && (
            <p className={styles.hint} style={{ color: 'var(--red)' }}>
              Под {loaderLabel} нет версии для Minecraft {mc.trim()} - выберите другую версию или загрузчик.
            </p>
          )}
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Отмена</button>
          <button className={styles.saveBtn} onClick={create} disabled={busy || !name.trim() || (needsLoaderVer && !loaderVer.trim()) || !mcValid}>Создать</button>
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
