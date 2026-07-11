import { useState, useEffect } from 'react'
import { Modpack } from '../../../types/modpack'
import styles from '../styles/AddModModal.module.css'

interface Props {
  modpack: Modpack
  modsDir: string
  kind?: 'mod' | 'resourcepack' | 'shader'
  onClose: () => void
}

type Source = 'modrinth' | 'curseforge'

// Единый вид результата поиска для обоих источников
interface Hit {
  id: string
  title: string
  description: string
  author: string
  downloads: number
  slug: string
}

export default function AddModModal({ modpack, modsDir, kind = 'mod', onClose }: Props) {
  const [source, setSource] = useState<Source>('modrinth')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [picker, setPicker] = useState<{ id: string; items: any[] } | null>(null)
  const [chosen, setChosen] = useState('')
  const [installed, setInstalled] = useState<string[]>([])

  useEffect(() => {
    window.api.mods.installed(modsDir).then(f => setInstalled(f as string[])).catch(() => {})
  }, [modsDir])

  // При смене источника сбрасываем выдачу
  useEffect(() => { setResults([]); setPicker(null); setNotice('') }, [source])

  const isInstalled = (slug: string) =>
    installed.some(f => f.replace(/\.disabled$/, '').replace(/\.jar$/, '').toLowerCase().includes(slug.toLowerCase()))

  const search = async () => {
    if (!query.trim()) return
    setLoading(true)
    setPicker(null)
    try {
      if (source === 'modrinth') {
        const hits = await window.api.modrinth.search(query, modpack.mc_version, modpack.loader, kind) as any[]
        setResults(hits.map(h => ({
          id: h.project_id, title: h.title, description: h.description,
          author: h.author, downloads: h.downloads, slug: h.slug
        })))
      } else {
        const hits = await window.api.curseforge.search(query, modpack.mc_version, modpack.loader, kind) as any[]
        setResults(hits.map(h => ({
          id: String(h.id), title: h.name, description: h.summary,
          author: h.authors?.[0]?.name ?? '', downloads: h.downloadCount, slug: String(h.id)
        })))
      }
    } catch {
      setNotice('Ошибка поиска. Проверьте соединение.')
    } finally {
      setLoading(false)
    }
  }

  const openPicker = async (hit: Hit) => {
    setInstalling(hit.id)
    setNotice('')
    try {
      if (source === 'modrinth') {
        const versions = await window.api.modrinth.versions(hit.id, modpack.mc_version, modpack.loader, kind) as any[]
        setInstalling(null)
        if (!versions.length) {
          setNotice(`Нет версий «${hit.title}» под ${modpack.loader} ${modpack.mc_version}`)
          return
        }
        setPicker({ id: hit.id, items: versions })
        setChosen(versions[0].id)
      } else {
        const files = (await window.api.curseforge.files(Number(hit.id), modpack.mc_version, modpack.loader, kind) as any[])
          .filter(f => f.downloadUrl) // без файлов, где автор закрыл стороннюю раздачу
        setInstalling(null)
        if (!files.length) {
          setNotice(`Нет доступных файлов «${hit.title}» под ${modpack.loader} ${modpack.mc_version} (возможно, автор запретил стороннюю загрузку — тогда только вручную с сайта).`)
          return
        }
        setPicker({ id: hit.id, items: files })
        setChosen(String(files[0].id))
      }
    } catch {
      setInstalling(null)
      setNotice('Ошибка загрузки версий')
    }
  }

  const doInstall = async () => {
    if (!picker) return
    if (source === 'modrinth') {
      const v = picker.items.find(x => x.id === chosen) ?? picker.items[0]
      const file = (v.files ?? []).find((f: { primary: boolean }) => f.primary) ?? v.files?.[0]
      if (!file) { setNotice('У версии нет файла для скачивания'); return }
      const projectFiles = new Set<string>(picker.items.flatMap((ver: any) => (ver.files ?? []).map((f: any) => f.filename)))
      for (const f of installed) {
        const base = f.replace(/\.disabled$/, '')
        if (base !== file.filename && projectFiles.has(base)) await window.api.mods.delete(modsDir, base).catch(() => {})
      }
      onClose()
      window.api.modrinth.download(file.url, file.filename, modsDir, file.hashes?.sha512)
    } else {
      const f = picker.items.find(x => String(x.id) === chosen) ?? picker.items[0]
      if (!f?.downloadUrl) { setNotice('У файла нет прямой ссылки (автор закрыл раздачу)'); return }
      const sha1 = (f.hashes ?? []).find((h: any) => h.algo === 1)?.value
      // Удаляем старые версии этого же мода
      const projectFiles = new Set<string>(picker.items.map((x: any) => x.fileName))
      for (const inst of installed) {
        const base = inst.replace(/\.disabled$/, '')
        if (base !== f.fileName && projectFiles.has(base)) await window.api.mods.delete(modsDir, base).catch(() => {})
      }
      onClose()
      window.api.curseforge.download(f.downloadUrl, f.fileName, modsDir, sha1)
    }
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

  const optLabel = (item: any, i: number) =>
    source === 'modrinth'
      ? `${item.version_number}${i === 0 ? ' (последняя)' : ''}`
      : `${item.displayName || item.fileName}${i === 0 ? ' (последняя)' : ''}`
  const optValue = (item: any) => source === 'modrinth' ? item.id : String(item.id)

  return (
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{kind === 'resourcepack' ? 'Добавить ресурспак' : kind === 'shader' ? 'Добавить шейдер' : 'Добавить мод'}</h2>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <div className={styles.sourceTabs}>
          <button className={`${styles.sourceTab} ${source === 'modrinth' ? styles.sourceActive : ''}`} onClick={() => setSource('modrinth')}>Modrinth</button>
          <button className={`${styles.sourceTab} ${source === 'curseforge' ? styles.sourceActive : ''}`} onClick={() => setSource('curseforge')}>CurseForge</button>
        </div>

        <div className={styles.searchRow}>
          <input
            className={styles.input}
            placeholder={`Поиск на ${source === 'modrinth' ? 'Modrinth' : 'CurseForge'}...`}
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
            <div key={r.id} className={styles.result}>
              <div className={styles.resultInfo}>
                <div className={styles.resultName}>{r.title}</div>
                <div className={styles.resultMeta}>{r.author} · {formatDownloads(r.downloads)} загрузок</div>
                <div className={styles.resultDesc}>{r.description}</div>
              </div>
              {picker?.id === r.id ? (
                <div className={styles.picker}>
                  <select className={styles.versionSelect} value={chosen} onChange={e => setChosen(e.target.value)}>
                    {picker.items.map((item, i) => (
                      <option key={optValue(item)} value={optValue(item)}>{optLabel(item, i)}</option>
                    ))}
                  </select>
                  <button className={styles.installBtn} onClick={doInstall}>Скачать</button>
                </div>
              ) : (
                <button
                  className={styles.installBtn}
                  onClick={() => openPicker(r)}
                  disabled={installing === r.id}
                >
                  {installing === r.id ? '...' : isInstalled(r.slug) ? 'Изменить' : 'Установить'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
