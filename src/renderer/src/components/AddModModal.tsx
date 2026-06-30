import { useState, useEffect } from 'react'
import { Modpack } from '../../../types/modpack'
import styles from '../styles/AddModModal.module.css'

interface Props {
  modpack: Modpack
  modsDir: string
  kind?: 'mod' | 'resourcepack' | 'shader'
  onClose: () => void
}

interface SearchResult {
  project_id: string
  slug: string
  title: string
  description: string
  author: string
  downloads: number
  icon_url: string | null
  categories: string[]
}

export default function AddModModal({ modpack, modsDir, kind = 'mod', onClose }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [picker, setPicker] = useState<{ id: string; versions: any[] } | null>(null)
  const [chosen, setChosen] = useState('')
  const [installed, setInstalled] = useState<string[]>([])

  useEffect(() => {
    window.api.mods.installed(modsDir).then(f => setInstalled(f as string[])).catch(() => {})
  }, [modsDir])

  const isInstalled = (slug: string) =>
    installed.some(f => f.replace(/\.disabled$/, '').replace(/\.jar$/, '').toLowerCase().includes(slug.toLowerCase()))

  const search = async () => {
    if (!query.trim()) return
    setLoading(true)
    try {
      const hits = await window.api.modrinth.search(query, modpack.mc_version, modpack.loader, kind)
      setResults(hits as SearchResult[])
    } finally {
      setLoading(false)
    }
  }

  const openPicker = async (mod: SearchResult) => {
    setInstalling(mod.project_id)
    setNotice('')
    try {
      const versions = await window.api.modrinth.versions(mod.project_id, modpack.mc_version, modpack.loader, kind) as any[]
      setInstalling(null)
      if (!versions.length) {
        setNotice(`Нет версий «${mod.title}», совместимых с ${modpack.loader} ${modpack.mc_version}`)
        return
      }
      setPicker({ id: mod.project_id, versions })
      setChosen(versions[0].id) // по умолчанию последняя
    } catch {
      setInstalling(null)
      setNotice('Ошибка загрузки версий')
    }
  }

  const doInstall = async () => {
    if (!picker) return
    const v = picker.versions.find(x => x.id === chosen) ?? picker.versions[0]
    const file = (v.files ?? []).find((f: { primary: boolean }) => f.primary) ?? v.files?.[0]
    if (!file) { setNotice('У версии нет файла для скачивания'); return }
    // Удаляем старые версии этого же мода (любой файл из версий проекта, кроме выбранного)
    const projectFiles = new Set<string>(
      picker.versions.flatMap((ver: any) => (ver.files ?? []).map((f: any) => f.filename))
    )
    for (const f of installed) {
      const base = f.replace(/\.disabled$/, '')
      if (base !== file.filename && projectFiles.has(base)) {
        await window.api.mods.delete(modsDir, base).catch(() => {})
      }
    }
    onClose()
    window.api.modrinth.download(file.url, file.filename, modsDir, file.hashes?.sha512)
  }

  const formatDownloads = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
    return String(n)
  }

  const addFromFile = async () => {
    const ext = kind === 'mod' ? 'jar' : 'zip'
    const path = await window.api.mods.addFile([ext])
    if (!path) return
    await window.api.mods.copyJar(path, modsDir)
    onClose()
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{kind === 'resourcepack' ? 'Добавить ресурспак' : kind === 'shader' ? 'Добавить шейдер' : 'Добавить мод'}</h2>
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
            {kind === 'mod' ? '.jar файл' : '.zip файл'}
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
              {picker?.id === r.project_id ? (
                <div className={styles.picker}>
                  <select className={styles.versionSelect} value={chosen} onChange={e => setChosen(e.target.value)}>
                    {picker.versions.map((v, i) => (
                      <option key={v.id} value={v.id}>
                        {v.version_number}{i === 0 ? ' (последняя)' : ''}
                      </option>
                    ))}
                  </select>
                  <button className={styles.installBtn} onClick={doInstall}>Скачать</button>
                </div>
              ) : (
                <button
                  className={styles.installBtn}
                  onClick={() => openPicker(r)}
                  disabled={installing === r.project_id}
                >
                  {installing === r.project_id ? '...' : isInstalled(r.slug) ? 'Изменить' : 'Установить'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
