import { useState } from 'react'
import { Modpack } from '../../../types/modpack'
import styles from '../styles/AddModModal.module.css'

interface Props {
  modpack: Modpack
  modsDir: string
  onClose: () => void
}

interface SearchResult {
  project_id: string
  title: string
  description: string
  author: string
  downloads: number
  icon_url: string | null
  categories: string[]
}

export default function AddModModal({ modpack, modsDir, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const search = async () => {
    if (!query.trim()) return
    setLoading(true)
    try {
      const hits = await window.api.modrinth.search(query, modpack.mc_version, modpack.loader)
      setResults(hits as SearchResult[])
    } finally {
      setLoading(false)
    }
  }

  const installMod = async (mod: SearchResult) => {
    setInstalling(mod.project_id)
    setNotice('')
    try {
      const versions = await window.api.modrinth.versions(mod.project_id, modpack.mc_version, modpack.loader) as any[]
      if (!versions.length) {
        setNotice(`Нет версий «${mod.title}», совместимых с ${modpack.loader} ${modpack.mc_version}`)
        setInstalling(null)
        return
      }
      const latest = versions[0]
      const file = (latest.files ?? []).find((f: { primary: boolean }) => f.primary) ?? latest.files?.[0]
      if (!file) {
        setNotice('У версии нет файла для скачивания')
        setInstalling(null)
        return
      }
      onClose() // закрываем сразу, прогресс идёт в bottom bar
      window.api.modrinth.download(file.url, file.filename, modsDir)
    } catch (e) {
      setNotice('Ошибка установки мода')
      setInstalling(null)
    }
  }

  const formatDownloads = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
    return String(n)
  }

  const addFromFile = async () => {
    const path = await window.api.mods.addFile()
    if (path) onClose()
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Добавить мод</h2>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <div className={styles.searchRow}>
          <input
            className={styles.input}
            placeholder="Поиск на Modrinth..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            autoFocus
          />
          <button className={styles.searchBtn} onClick={search}>Найти</button>
          <button className={styles.fileBtn} onClick={addFromFile}>
            .jar файл
          </button>
        </div>

        {notice && <div className={styles.notice}>{notice}</div>}

        <div className={styles.results}>
          {loading && <div className={styles.hint}>Поиск...</div>}
          {!loading && results.length === 0 && query && (
            <div className={styles.hint}>Ничего не найдено</div>
          )}
          {results.map(r => (
            <div key={r.project_id} className={styles.result}>
              <div className={styles.resultInfo}>
                <div className={styles.resultName}>{r.title}</div>
                <div className={styles.resultMeta}>{r.author} · {formatDownloads(r.downloads)} загрузок</div>
                <div className={styles.resultDesc}>{r.description}</div>
              </div>
              <button
                className={styles.installBtn}
                onClick={() => installMod(r)}
                disabled={installing === r.project_id}
              >
                {installing === r.project_id ? '...' : 'Установить'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
