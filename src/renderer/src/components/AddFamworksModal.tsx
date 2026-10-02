import { useState, useEffect } from 'react'
import { Mod } from '../../../types/modpack'
import styles from '../styles/AddModrinthModal.module.css'

interface FwFile { filename: string; size: number; primary?: boolean }
interface FwVersion { id: string; version_number: string; files: FwFile[] }
interface FwItem {
  id: string
  name: string
  kind: 'mod' | 'resourcepack' | 'shader'
  description?: string
  release: FwVersion | null
  test: FwVersion | null
}

interface Props {
  mcVersion: string
  loader: string
  existing: string[]
  kind?: 'mod' | 'resourcepack' | 'shader'
  onAdd: (mod: Mod) => void
  onClose: () => void
}

const KIND_LABEL = { mod: 'мод', resourcepack: 'ресурспак', shader: 'шейдер' }

export default function AddFamworksModal({ mcVersion, loader, existing, kind = 'mod', onAdd, onClose }: Props) {
  const [paired, setPaired] = useState<boolean | null>(null) // null — проверяем
  const [code, setCode] = useState('')
  const [pairing, setPairing] = useState(false)
  const [pairErr, setPairErr] = useState('')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<FwItem[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [fixed, setFixed] = useState<Record<string, string>>({})          // id → зафиксированная версия
  const [versions, setVersions] = useState<Record<string, FwVersion[]>>({})

  useEffect(() => { window.api.portal.status().then(s => setPaired(s.paired)).catch(() => setPaired(false)) }, [])

  const load = async () => {
    setLoading(true); setNotice('')
    try { setItems(await window.api.famworks.catalog({ mc_version: mcVersion, loader, kind, q: query }) as FwItem[]) }
    catch { setNotice('Не удалось загрузить каталог') }
    finally { setLoading(false) }
  }
  useEffect(() => { if (paired) load() }, [paired]) // eslint-disable-line react-hooks/exhaustive-deps

  const doPair = async () => {
    if (!code.trim()) return
    setPairing(true); setPairErr('')
    const r = await window.api.portal.pair(code.trim())
    setPairing(false)
    if (r.ok) setPaired(true)
    else setPairErr(r.error ?? 'Не удалось привязать')
  }

  // Включить/выключить фиксацию версии (при включении — грузим список версий).
  const toggleFix = async (it: FwItem) => {
    if (fixed[it.id] !== undefined) { setFixed(p => { const n = { ...p }; delete n[it.id]; return n }); return }
    let vs = versions[it.id]
    if (!vs) {
      try { vs = await window.api.famworks.versions(it.id) as FwVersion[]; setVersions(p => ({ ...p, [it.id]: vs })) }
      catch { setNotice('Не удалось загрузить версии'); return }
    }
    setFixed(p => ({ ...p, [it.id]: vs![0]?.version_number ?? '' }))
  }

  const add = (it: FwItem) => {
    const fixVer = fixed[it.id]
    let ver = it.release
    if (fixVer !== undefined && versions[it.id]) ver = versions[it.id].find(v => v.version_number === fixVer) ?? ver
    const file = ver?.files?.find(f => f.primary) ?? ver?.files?.[0]
    const mod: Mod = {
      id: it.id,
      name: it.name,
      famworks_id: it.id,
      ...(fixVer ? { famworks_version: fixVer } : {}),
      filename: file?.filename ?? `${it.id}.jar`,
      version: ver?.version_number ?? '',
      category: 'FamWorks',
      size_mb: file ? Math.round((file.size / 1024 / 1024) * 100) / 100 : 0,
      required: false
    }
    onAdd(mod)
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Добавить {KIND_LABEL[kind]} из портала FamWorks</h2>
          <span className={styles.ctx}>{loader} · {mcVersion}</span>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        {paired === null ? (
          <div className={styles.hint}>Проверка привязки…</div>
        ) : !paired ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #bbb)', lineHeight: 1.5 }}>
              Чтобы брать моды с портала, привяжи редактор: возьми одноразовый код в своём профиле на портале и вставь сюда.
            </p>
            <div className={styles.searchRow}>
              <input className={styles.input} placeholder="Код (напр. ABCD-2345)" value={code} autoFocus maxLength={12}
                onChange={e => { setCode(e.target.value); setPairErr('') }} onKeyDown={e => e.key === 'Enter' && doPair()} />
              <button className={styles.searchBtn} onClick={doPair} disabled={pairing || !code.trim()}>{pairing ? '…' : 'Привязать'}</button>
            </div>
            {pairErr && <div className={styles.notice}>{pairErr}</div>}
          </div>
        ) : (
          <>
            <div className={styles.searchRow}>
              <input className={styles.input} placeholder="Поиск в каталоге…" value={query} autoFocus
                onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
              <button className={styles.searchBtn} onClick={load}>Найти</button>
            </div>
            {notice && <div className={styles.notice}>{notice}</div>}
            <div className={styles.results}>
              {loading && <div className={styles.hint}>Загрузка…</div>}
              {!loading && items.length === 0 && <div className={styles.hint}>Пусто</div>}
              {items.map(it => {
                const added = existing.includes(it.id)
                const isFixed = fixed[it.id] !== undefined
                return (
                  <div key={it.id} className={styles.result}>
                    <div className={styles.info}>
                      <div className={styles.name}>{it.name}</div>
                      <div className={styles.meta}>
                        FamWorks{it.release ? ` · ${it.release.version_number}` : ''}
                        {it.test ? ' · есть test' : ''}
                      </div>
                      {it.description && <div className={styles.desc}>{it.description}</div>}
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, marginTop: 6, cursor: 'pointer' }}>
                        <input type="checkbox" checked={isFixed} onChange={() => toggleFix(it)} />
                        Зафиксировать версию
                        {isFixed && (
                          <select className={styles.input} style={{ maxWidth: 160, marginLeft: 6 }}
                            value={fixed[it.id]} onChange={e => setFixed(p => ({ ...p, [it.id]: e.target.value }))}>
                            {(versions[it.id] ?? []).map((v, i) => (
                              <option key={v.id} value={v.version_number}>{v.version_number}{i === 0 ? ' (новая)' : ''}</option>
                            ))}
                          </select>
                        )}
                      </label>
                    </div>
                    <button className={styles.addBtn} disabled={added} onClick={() => add(it)}>
                      {added ? 'Добавлен' : 'Добавить'}
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
