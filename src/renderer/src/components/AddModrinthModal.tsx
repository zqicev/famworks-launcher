import { useState } from 'react'
import { Mod } from '../../../types/modpack'
import styles from '../styles/AddModrinthModal.module.css'

interface Hit {
  project_id: string
  slug: string
  title: string
  description: string
  author: string
  downloads: number
  categories: string[]
}

interface Props {
  mcVersion: string
  loader: string
  existing: string[]
  kind?: 'mod' | 'resourcepack'
  onAdd: (mod: Mod) => void
  onClose: () => void
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

export default function AddModrinthModal({ mcVersion, loader, existing, kind = 'mod', onAdd, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const search = async () => {
    if (!query.trim()) return
    setLoading(true); setNotice('')
    try {
      setHits(await window.api.modrinth.search(query, mcVersion, loader, kind))
    } catch {
      setNotice('Ошибка поиска Modrinth')
    } finally {
      setLoading(false)
    }
  }

  const add = async (hit: Hit) => {
    setAdding(hit.project_id); setNotice('')
    try {
      const version = await window.api.modrinth.latest(hit.project_id, mcVersion, loader, kind)
      if (!version) { setNotice(`Нет версии «${hit.title}» под ${loader} ${mcVersion}`); setAdding(null); return }
      const file = version.files.find(f => f.primary) ?? version.files[0]
      if (!file) { setNotice('У версии нет файла'); setAdding(null); return }

      const mod: Mod = {
        id: hit.slug,
        name: hit.title,
        modrinth_id: hit.project_id,
        download_url: file.url,
        filename: file.filename,
        sha512: file.hashes?.sha512,
        version: version.version_number,
        category: hit.categories[0] ?? 'Мод',
        size_mb: Math.round((file.size / 1024 / 1024) * 10) / 10,
        required: false
      }
      onAdd(mod)
      setAdding(null)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Ошибка добавления')
      setAdding(null)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Добавить мод из Modrinth</h2>
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
            const added = existing.includes(h.slug)
            return (
              <div key={h.project_id} className={styles.result}>
                <div className={styles.info}>
                  <div className={styles.name}>{h.title}</div>
                  <div className={styles.meta}>{h.author} · {fmt(h.downloads)} загрузок</div>
                  <div className={styles.desc}>{h.description}</div>
                </div>
                <button className={styles.addBtn} disabled={added || adding === h.project_id} onClick={() => add(h)}>
                  {added ? 'Добавлен' : adding === h.project_id ? '…' : 'Добавить'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
