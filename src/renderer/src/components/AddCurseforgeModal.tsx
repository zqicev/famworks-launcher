import { useState } from 'react'
import { Mod } from '../../../types/modpack'
import styles from '../styles/AddModrinthModal.module.css'

interface Hit { id: number; name: string; summary: string; downloadCount: number; authors: { name: string }[] }

interface Props {
  mcVersion: string
  loader: string
  existing: string[]
  kind?: 'mod' | 'resourcepack' | 'shader'
  onAdd: (mod: Mod) => void
  onClose: () => void
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}
function slug(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') }

export default function AddCurseforgeModal({ mcVersion, loader, existing, kind = 'mod', onAdd, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [picker, setPicker] = useState<{ id: number; files: any[] } | null>(null)
  const [chosen, setChosen] = useState('')

  const search = async () => {
    if (!query.trim()) return
    setLoading(true); setNotice('')
    try {
      setHits(await window.api.cf.search(query, mcVersion, loader, kind))
    } catch {
      setNotice('Ошибка CurseForge. Проверь API-ключ (шестерёнка слева).')
    } finally {
      setLoading(false)
    }
  }

  const openPicker = async (hit: Hit) => {
    setNotice('')
    try {
      const files = await window.api.cf.files(hit.id, mcVersion, loader, kind)
      if (!files.length) { setNotice(`Нет файлов «${hit.name}» под ${mcVersion}`); return }
      setPicker({ id: hit.id, files })
      setChosen(String(files[0].id))
    } catch {
      setNotice('Ошибка загрузки файлов')
    }
  }

  const add = async (hit: Hit) => {
    if (!picker) return
    const file = picker.files.find((f: any) => String(f.id) === chosen) ?? picker.files[0]
    const { url, sha1 } = await window.api.cf.resolve(file)
    const mod: Mod = {
      id: slug(hit.name),
      name: hit.name,
      curseforge_id: hit.id,
      download_url: url,
      sha1,
      filename: file.fileName,
      version: file.displayName,
      category: kind === 'mod' ? 'Мод' : kind === 'shader' ? 'Шейдер' : 'Ресурспак',
      size_mb: Math.round((file.fileLength / 1024 / 1024) * 10) / 10,
      required: false
    }
    onAdd(mod)
    setPicker(null)
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>CurseForge — {kind === 'shader' ? 'шейдер' : kind === 'resourcepack' ? 'ресурспак' : 'мод'}</h2>
          <span className={styles.ctx}>{loader} · {mcVersion}</span>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>
        <div className={styles.searchRow}>
          <input className={styles.input} placeholder="Поиск…" value={query} autoFocus
            onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} />
          <button className={styles.searchBtn} onClick={search}>Найти</button>
        </div>
        {notice && <div className={styles.notice}>{notice}</div>}
        <div className={styles.results}>
          {loading && <div className={styles.hint}>Поиск…</div>}
          {!loading && hits.length === 0 && query && <div className={styles.hint}>Ничего не найдено</div>}
          {hits.map(h => {
            const added = existing.includes(slug(h.name))
            return (
              <div key={h.id} className={styles.result}>
                <div className={styles.info}>
                  <div className={styles.name}>{h.name}</div>
                  <div className={styles.meta}>{h.authors?.[0]?.name} · {fmt(h.downloadCount)} загрузок</div>
                  <div className={styles.desc}>{h.summary}</div>
                </div>
                {picker?.id === h.id ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select className={styles.input} style={{ maxWidth: 150 }} value={chosen} onChange={e => setChosen(e.target.value)}>
                      {picker.files.map((f: any, i: number) => <option key={f.id} value={f.id}>{f.displayName}{i === 0 ? ' (новый)' : ''}</option>)}
                    </select>
                    <button className={styles.addBtn} onClick={() => add(h)}>OK</button>
                  </div>
                ) : (
                  <button className={styles.addBtn} disabled={added} onClick={() => openPicker(h)}>
                    {added ? 'Добавлен' : 'Выбрать'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
