import { useState } from 'react'
import styles from '../styles/SettingsModal.module.css'

interface Props {
  defaultLoader: string
  defaultMc: string
  onClose: () => void
  onCreated: (path: string) => void
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
}

export default function CreateModModal({ defaultLoader, defaultMc, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [modId, setModId] = useState('')
  const [modIdEdited, setModIdEdited] = useState(false)
  const [loader, setLoader] = useState(defaultLoader === 'neoforge' ? 'neoforge' : 'fabric')
  const [mc, setMc] = useState(defaultMc || '1.21.1')
  const [dest, setDest] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const onName = (v: string) => {
    setName(v)
    if (!modIdEdited) setModId(slugify(v))
  }
  const pickDest = async () => {
    const p = await window.api.dialog.pickFolder()
    if (p) setDest(p)
  }
  const create = async () => {
    setBusy(true); setErr('')
    const r = await window.api.dev.generateMod({ name: name.trim(), modId: modId.trim(), loader, mcVersion: mc.trim(), dest })
    setBusy(false)
    if (r.ok && r.path) onCreated(r.path)
    else setErr(r.error ?? 'Ошибка')
  }
  const canCreate = !!name.trim() && !!modId.trim() && !!dest && !busy

  return (
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Новый мод</h2>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          <Field label="НАЗВАНИЕ">
            <input className={styles.cinput} value={name} maxLength={40} onChange={e => onName(e.target.value)} placeholder="Мой мод" autoFocus />
          </Field>
          <Field label="MOD ID">
            <input className={styles.cinput} value={modId} onChange={e => { setModId(slugify(e.target.value)); setModIdEdited(true) }} placeholder="my_mod" />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="ЗАГРУЗЧИК">
              <select className={styles.cinput} value={loader} onChange={e => setLoader(e.target.value)}>
                <option value="fabric">Fabric</option>
                <option value="neoforge">NeoForge</option>
              </select>
            </Field>
            <Field label="ВЕРСИЯ MC">
              <input className={styles.cinput} value={mc} onChange={e => setMc(e.target.value)} placeholder="1.21.1" />
            </Field>
          </div>
          <Field label="ПАПКА НАЗНАЧЕНИЯ">
            <div style={{ display: 'flex', gap: 8 }}>
              <input className={styles.cinput} value={dest} readOnly placeholder="Куда создать проект" style={{ flex: 1 }} />
              <button className={styles.cancelBtn} onClick={pickDest}>Обзор</button>
            </div>
          </Field>
          <p className={styles.hint}>
            Проект создастся в <b>{dest ? `${dest}\\${modId || '…'}` : '…'}</b> из официального шаблона
            ({loader === 'fabric' ? 'Fabric Example Mod' : 'NeoForge MDK'}). Нужен доступ к github.com.
          </p>
          {err && <p className={styles.hint} style={{ color: 'var(--red)' }}>{err}</p>}
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Отмена</button>
          <button className={styles.saveBtn} onClick={create} disabled={!canCreate}>{busy ? 'Создаю…' : 'Создать'}</button>
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
