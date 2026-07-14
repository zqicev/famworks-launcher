import { useState, useEffect, useRef } from 'react'
import { Modpack } from '../../../types/modpack'
import ProjectDetail from './ProjectDetail'
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
  const [detailId, setDetailId] = useState<string | null>(null) // открыта страница обзора этого проекта
  const reqRef = useRef(0) // токен запроса — отбрасываем устаревшие ответы при быстром переключении

  const target = packs.find(p => p.id === targetId) ?? null

  // Загрузка выдачи. Пустой запрос = популярное (список по умолчанию).
  const load = async (q = query) => {
    const my = ++reqRef.current
    setLoading(true); setPicker(null); setNotice('')
    const mc = type === 'modpack' ? '' : (target?.mc_version ?? '')
    const loader = type === 'modpack' ? '' : (target?.loader ?? '')
    try {
      let mapped: Hit[]
      if (source === 'modrinth') {
        const hits = await window.api.modrinth.search(q, mc, loader, type) as any[]
        mapped = hits.map(h => ({
          id: h.project_id, title: h.title, description: h.description, author: h.author,
          downloads: h.downloads, icon: h.icon_url ?? null, url: `https://modrinth.com/${type}/${h.slug}`
        }))
      } else {
        const hits = await window.api.curseforge.search(q, mc, loader, type) as any[]
        mapped = hits.map(h => ({
          id: String(h.id), title: h.name, description: h.summary, author: h.authors?.[0]?.name ?? '',
          downloads: h.downloadCount, icon: h.logo?.thumbnailUrl ?? null,
          url: h.links?.websiteUrl ?? `https://www.curseforge.com/minecraft/${h.slug ?? ''}`
        }))
      }
      if (my !== reqRef.current) return // пришёл более свежий запрос — этот отбрасываем
      setResults(mapped)
    } catch {
      if (my !== reqRef.current) return
      setResults([])
      setNotice('Ошибка загрузки. Проверьте соединение.')
    } finally {
      if (my === reqRef.current) setLoading(false)
    }
  }

  // При открытии и смене источника/типа/целевой сборки показываем популярное (или текущий запрос).
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, type, targetId])

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

  const doInstall = async (hit: Hit) => {
    if (!picker || !target || type === 'modpack') return
    const packRoot = `${installPath}/${target.id}`
    setPicker(null); setBusyId(hit.id)
    showToast(`Установка «${hit.title}»…`, 'info')
    try {
      const res = await window.api.browser.install(source, type, hit.id, chosen, target.mc_version, target.loader, packRoot)
      if (res.ok) {
        const n = res.installed.length
        showToast(n > 1 ? `«${hit.title}» и зависимости установлены (${n} файлов) в «${target.name}»` : `«${hit.title}» установлен в «${target.name}»`, 'success')
      } else showToast(res.error || 'Не удалось установить', 'error')
    } catch (e) {
      showToast(`Ошибка: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setBusyId(null)
    }
  }

  const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n)
  const optLabel = (item: any, i: number) => source === 'modrinth'
    ? `${item.version_number}${i === 0 ? ' (последняя)' : ''}`
    : `${item.displayName || item.fileName}${i === 0 ? ' (последняя)' : ''}`
  const optValue = (item: any) => source === 'modrinth' ? item.id : String(item.id)

  if (detailId) {
    return (
      <ProjectDetail
        source={source}
        type={type}
        id={detailId}
        target={target}
        installPath={installPath}
        onBack={() => setDetailId(null)}
        onImported={onImported}
        showToast={showToast}
      />
    )
  }

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
            value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} autoFocus />
          <button className={styles.searchBtn} onClick={() => load()}>Найти</button>
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
        {loading && <div className={styles.hint}>Загрузка…</div>}
        {!loading && results.length === 0 && <div className={styles.hint}>Ничего не найдено</div>}
        {results.map(r => (
          <div key={r.id} className={styles.card} onClick={() => setDetailId(r.id)} title="Открыть страницу">
            <div className={styles.icon}><Icon src={r.icon} title={r.title} /></div>
            <div className={styles.cardInfo}>
              <div className={styles.cardName}>{r.title}</div>
              <div className={styles.cardMeta}>{r.author && `${r.author} · `}{fmt(r.downloads)} загрузок</div>
              <div className={styles.cardDesc}>{r.description}</div>
            </div>
            <div className={styles.actions} onClick={e => e.stopPropagation()}>
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
