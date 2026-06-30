import { useState, useEffect } from 'react'
import styles from '../styles/TokenSetup.module.css'

export default function CfKeyModal({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { window.api.cfg.get('cfKey').then(v => setKey((v as string) ?? '')) }, [])

  const save = async () => {
    setBusy(true); setMsg('')
    await window.api.cfg.set('cfKey', key.trim())
    const ok = await window.api.cf.validate()
    setBusy(false)
    if (ok) onClose()
    else setMsg('Ключ не прошёл проверку (сохранён). Получить: console.curseforge.com')
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }} onClick={onClose}>
      <div className={styles.card} style={{ width: 460 }} onClick={e => e.stopPropagation()}>
        <h1 className={styles.title} style={{ fontSize: 22 }}>Ключ CurseForge</h1>
        <p className={styles.desc}>
          Нужен для поиска модов/ресурспаков/шейдеров на CurseForge. Получить бесплатно:
          <b> console.curseforge.com</b> → API Keys. Хранится локально, в раздаваемый лаунчер не попадает.
        </p>
        <input className={styles.input} type="password" placeholder="$2a$10$..." value={key}
          onChange={e => { setKey(e.target.value); setMsg('') }} onKeyDown={e => e.key === 'Enter' && save()} autoFocus />
        {msg && <div className={styles.error}>{msg}</div>}
        <button className={styles.btn} onClick={save} disabled={busy}>{busy ? 'Проверка…' : 'Сохранить'}</button>
      </div>
    </div>
  )
}
