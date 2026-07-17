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
  kind?: 'mod' | 'resourcepack' | 'shader'
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [picker, setPicker] = useState<{ id: string; versions: any[] } | null>(null)
  const [chosen, setChosen] = useState('')

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

  // Загружаем список версий и показываем выбор (по образцу CurseForge-модалки)
  const openPicker = async (hit: Hit) => {
    setAdding(hit.project_id); setNotice('')
    try {
      const versions = await window.api.modrinth.versions(hit.project_id, mcVersion, loader, kind)
      if (!versions.length) { setNotice(`Нет версии «${hit.title}» под ${loader} ${mcVersion}`); return }
      setPicker({ id: hit.project_id, versions })
      setChosen(versions[0].id)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Ошибка загрузки версий')
    } finally {
      setAdding(null)
    }
  }

  const add = (hit: Hit) => {
    if (!picker) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const version = picker.versions.find((v: any) => v.id === chosen) ?? picker.versions[0]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const file = version.files.find((f: any) => f.primary) ?? version.files[0]
    if (!file) { setNotice('У версии нет файла'); return }

    const mod: Mod = {
      id: hit.slug,
      name: hit.title,
      modrinth_id: hit.project_id,
      modrinth_version_number: version.version_number,
      download_url: file.url,
      filename: file.filename,
      sha512: file.hashes?.sha512,
      version: version.version_number,
      category: hit.categories[0] ?? 'Мод',
      size_mb: Math.round((file.size / 1024 / 1024) * 10) / 10,
      required: false
    }
    onAdd(mod)
    setPicker(null)
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
                {picker?.id === h.project_id ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select className={styles.input} style={{ maxWidth: 150 }} value={chosen} onChange={e => setChosen(e.target.value)}>
                      {picker.versions.map((v: { id: string; version_number: string }, i: number) => (
                        <option key={v.id} value={v.id}>{v.version_number}{i === 0 ? ' (новый)' : ''}</option>
                      ))}
                    </select>
                    <button className={styles.addBtn} onClick={() => add(h)}>OK</button>
                  </div>
                ) : (
                  <button className={styles.addBtn} disabled={added || adding === h.project_id} onClick={() => openPicker(h)}>
                    {added ? 'Добавлен' : adding === h.project_id ? '…' : 'Выбрать'}
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
