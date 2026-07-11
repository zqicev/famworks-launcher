import { useState, useEffect } from 'react'
import { Modpack } from '../../../types/modpack'
import styles from '../styles/BrowserView.module.css'

type Source = 'modrinth' | 'curseforge'
type CType = 'modpack' | 'mod' | 'resourcepack' | 'shader'

interface TargetPack { id: string; name: string; mc_version: string; loader: string }

interface Props {
  installPath: string
  packs: TargetPack[]
  defaultTargetId: string | null
  onImported: (mp: Modpack) => void
  showToast: (text: string, kind: 'info' | 'success' | 'error') => void
}

// Единый вид результата для обоих источников
interface Hit {
  id: string
  title: string
  description: string
  author: string
  downloads: number
  icon: string | null
  url: string
}

const TYPES: { key: CType; label: string }[] = [
  { key: 'modpack', label: 'Сборки' },
  { key: 'mod', label: 'Моды' },
  { key: 'resourcepack', label: 'Ресурспаки' },
  { key: 'shader', label: 'Шейдеры' }
]
const FOLDER: Record<Exclude<CType, 'modpack'>, string> = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }

function Icon({ src, title }: { src: string | null; title: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) return <span>{title[0]?.toUpperCase() ?? '?'}</span>
  return <img src={src} alt="" onError={() => setBroken(true)} />
}

export default function BrowserView({ installPath, packs, defaultTargetId, onImported, showToast }: Props) {
  const [source, setSource] = useState<Source>('modrinth')
  const [type, setType] = useState<CType>('modpack')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [targetId, setTargetId] = useState<string | null>(defaultTargetId ?? packs[0]?.id ?? null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [picker, setPicker] = useState<{ id: string; items: any[] } | null>(null)
  const [chosen, setChosen] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const target = packs.find(p => p.id === targetId) ?? null

  // Смена источника/типа сбрасывает выдачу
  useEffect(() => { setResults([]); setPicker(null); setNotice('') }, [source, type])

  const search = async () => {
    if (!query.trim()) return
    setLoading(true); setPicker(null); setNotice('')
    const mc = type === 'modpack' ? '' : (target?.mc_version ?? '')
    const loader = type === 'modpack' ? '' : (target?.loader ?? '')
    try {
      if (source === 'modrinth') {
        const hits = await window.api.modrinth.search(query, mc, loader, type) as any[]
        setResults(hits.map(h => ({
          id: h.project_id, title: h.title, description: h.description, author: h.author,
          downloads: h.downloads, icon: h.icon_url ?? null, url: `https://modrinth.com/${type}/${h.slug}`
        })))
      } else {
        const hits = await window.api.curseforge.search(query, mc, loader, type) as any[]
        setResults(hits.map(h => ({
          id: String(h.id), title: h.name, description: h.summary, author: h.authors?.[0]?.name ?? '',
          downloads: h.downloadCount, icon: h.logo?.thumbnailUrl ?? null,
          url: h.links?.websiteUrl ?? `https://www.curseforge.com/minecraft/${h.slug ?? ''}`
        })))
      }
    } catch {
      setNotice('Ошибка поиска. Проверьте соединение.')
    } finally {
      setLoading(false)
    }
  }

  // Сборки: Modrinth импортируем как кастомную, CurseForge открываем на сайте (импорт заблокирован прокси)
  const installModpack = async (hit: Hit) => {
    if (source === 'curseforge') { window.api.shell.openExternal(hit.url); return }
    setBusyId(hit.id)
    showToast(`Установка «${hit.title}»…`, 'info')
    try {
      const res = await window.api.browser.installModpack('modrinth', hit.id)
      if (res.ok && res.modpack) { onImported(res.modpack); showToast(`Сборка «${res.modpack.name}» установлена`, 'success') }
      else showToast(res.error || 'Не удалось установить сборку', 'error')
    } catch (e) {
      showToast(`Ошибка: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setBusyId(null)
    }
  }

  // Моды/ресурспаки/шейдеры: выбираем версию и скачиваем в папку выбранной сборки
  const openPicker = async (hit: Hit) => {
    if (!target) { setNotice('Сначала выберите сборку, куда установить'); return }
    setBusyId(hit.id); setNotice('')
    try {
      if (source === 'modrinth') {
        const versions = await window.api.modrinth.versions(hit.id, target.mc_version, target.loader, type) as any[]
        setBusyId(null)
        if (!versions.length) { setNotice(`Нет версий «${hit.title}» под ${target.loader} ${target.mc_version}`); return }
        setPicker({ id: hit.id, items: versions }); setChosen(versions[0].id)
      } else {
        const files = (await window.api.curseforge.files(Number(hit.id), target.mc_version, target.loader, type) as any[]).filter(f => f.downloadUrl)
        setBusyId(null)
        if (!files.length) { setNotice(`Нет файлов «${hit.title}» под ${target.loader} ${target.mc_version} (возможно, автор закрыл стороннюю раздачу)`); return }
        setPicker({ id: hit.id, items: files }); setChosen(String(files[0].id))
      }
    } catch {
      setBusyId(null); setNotice('Ошибка загрузки версий')
    }
  }

  const doInstall = (hit: Hit) => {
    if (!picker || !target || type === 'modpack') return
    const dir = `${installPath}/${target.id}/${FOLDER[type]}`
    if (source === 'modrinth') {
      const v = picker.items.find(x => x.id === chosen) ?? picker.items[0]
      const file = (v.files ?? []).find((f: any) => f.primary) ?? v.files?.[0]
      if (!file) { setNotice('У версии нет файла для скачивания'); return }
      setPicker(null)
      window.api.modrinth.download(file.url, file.filename, dir, file.hashes?.sha512)
    } else {
      const f = picker.items.find(x => String(x.id) === chosen) ?? picker.items[0]
      if (!f?.downloadUrl) { setNotice('У файла нет прямой ссылки'); return }
      const sha1 = (f.hashes ?? []).find((h: any) => h.algo === 1)?.value
      setPicker(null)
      window.api.curseforge.download(f.downloadUrl, f.fileName, dir, sha1)
    }
    showToast(`«${hit.title}» добавляется в «${target.name}»`, 'success')
  }

  const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n)
  const optLabel = (item: any, i: number) => source === 'modrinth'
    ? `${item.version_number}${i === 0 ? ' (последняя)' : ''}`
    : `${item.displayName || item.fileName}${i === 0 ? ' (последняя)' : ''}`
  const optValue = (item: any) => source === 'modrinth' ? item.id : String(item.id)

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <div className={styles.badge}>КАТАЛОГ · MODRINTH + CURSEFORGE</div>
        <h1 className={styles.title}>Браузер</h1>
        <p className={styles.desc}>Поиск и установка сборок, модов, ресурспаков и шейдеров</p>

        <div className={styles.controls}>
          <div className={styles.seg}>
            {TYPES.map(t => (
              <button key={t.key} className={`${styles.segBtn} ${type === t.key ? styles.segOn : ''}`} onClick={() => setType(t.key)}>{t.label}</button>
            ))}
          </div>
          <div className={styles.seg}>
            <button className={`${styles.segBtn} ${source === 'modrinth' ? styles.segOn : ''}`} onClick={() => setSource('modrinth')}>Modrinth</button>
            <button className={`${styles.segBtn} ${source === 'curseforge' ? styles.segOn : ''}`} onClick={() => setSource('curseforge')}>CurseForge</button>
          </div>
        </div>

        <div className={styles.searchRow}>
          <input className={styles.input} placeholder={`Поиск на ${source === 'modrinth' ? 'Modrinth' : 'CurseForge'}…`}
            value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} autoFocus />
          <button className={styles.searchBtn} onClick={search}>Найти</button>
          {type !== 'modpack' && (
            <select className={styles.target} value={targetId ?? ''} onChange={e => setTargetId(e.target.value)} title="Куда установить">
              {packs.length === 0 && <option value="">нет сборок</option>}
              {packs.map(p => <option key={p.id} value={p.id}>→ {p.name} · {p.loader} {p.mc_version}</option>)}
            </select>
          )}
        </div>
        {notice && <div className={styles.notice}>{notice}</div>}
      </div>

      <div className={styles.results}>
        {loading && <div className={styles.hint}>Поиск…</div>}
        {!loading && results.length === 0 && query && <div className={styles.hint}>Ничего не найдено</div>}
        {!loading && !query && (
          <div className={styles.hint}>
            {type === 'modpack'
              ? 'Найдите сборку — Modrinth установится к вам, CurseForge откроется на сайте'
              : 'Найдите контент и установите его в выбранную справа сборку'}
          </div>
        )}
        {results.map(r => (
          <div key={r.id} className={styles.card}>
            <div className={styles.icon}><Icon src={r.icon} title={r.title} /></div>
            <div className={styles.cardInfo}>
              <div className={styles.cardName}>{r.title}</div>
              <div className={styles.cardMeta}>{r.author && `${r.author} · `}{fmt(r.downloads)} загрузок</div>
              <div className={styles.cardDesc}>{r.description}</div>
            </div>
            <div className={styles.actions}>
              {type === 'modpack' ? (
                <button className={styles.installBtn} disabled={busyId === r.id} onClick={() => installModpack(r)}>
                  {busyId === r.id ? '…' : source === 'curseforge' ? 'На CurseForge ↗' : 'Установить'}
                </button>
              ) : picker?.id === r.id ? (
                <div className={styles.picker}>
                  <select className={styles.versionSelect} value={chosen} onChange={e => setChosen(e.target.value)}>
                    {picker.items.map((item, i) => <option key={optValue(item)} value={optValue(item)}>{optLabel(item, i)}</option>)}
                  </select>
                  <button className={styles.installBtn} onClick={() => doInstall(r)}>Скачать</button>
                </div>
              ) : (
                <button className={styles.installBtn} disabled={busyId === r.id} onClick={() => openPicker(r)}>
                  {busyId === r.id ? '…' : 'Установить'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
