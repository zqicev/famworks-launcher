import { useState, useEffect, useRef } from 'react'
import { Modpack } from '../../../types/modpack'
import ProjectDetail from './ProjectDetail'
import InstallModal from './InstallModal'
import { formatCount } from '../lib/format'
import { Source, ContentType, TargetPack } from '../lib/browser'
import styles from '../styles/BrowserView.module.css'

interface Props {
  installPath: string
  packs: TargetPack[]
  contextPack: TargetPack | null // если браузер открыт из сборки — фильтруем по её версии/загрузчику
  initialType: ContentType
  onImported: (mp: Modpack) => void
  showToast: (text: string, kind: 'info' | 'success' | 'error') => void
}

interface Hit {
  id: string
  title: string
  description: string
  author: string
  downloads: number
  icon: string | null
  url: string
}

const TYPES: { key: ContentType; label: string }[] = [
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

export default function BrowserView({ installPath, packs, contextPack, initialType, onImported, showToast }: Props) {
  const [source, setSource] = useState<Source>('modrinth')
  const [type, setType] = useState<ContentType>(initialType)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [installItem, setInstallItem] = useState<{ id: string; title: string } | null>(null)
  const reqRef = useRef(0) // токен запроса — отбрасываем устаревшие ответы при быстром переключении

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const load = async (q = query) => {
    const my = ++reqRef.current
    setLoading(true); setNotice('')
    const mc = type === 'modpack' ? '' : (contextPack?.mc_version ?? '')
    const loader = type === 'modpack' ? '' : (contextPack?.loader ?? '')
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
      if (my !== reqRef.current) return
      setResults(mapped)
    } catch {
      if (my !== reqRef.current) return
      setResults([]); setNotice('Ошибка загрузки. Проверьте соединение.')
    } finally {
      if (my === reqRef.current) setLoading(false)
    }
  }

  // Популярное при открытии и смене источника/типа (или текущий запрос).
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, type])

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

  const openInstall = (hit: Hit) => {
    if (type === 'modpack') { installModpack(hit); return }
    if (packs.length === 0) { setNotice('Сначала создайте или установите сборку — тогда будет куда ставить'); return }
    setInstallItem({ id: hit.id, title: hit.title })
  }

  if (detailId) {
    return (
      <ProjectDetail
        source={source}
        type={type}
        id={detailId}
        packs={packs}
        preferredPackId={contextPack?.id ?? null}
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
        <p className={styles.desc}>
          {contextPack && type !== 'modpack'
            ? `Совместимое с «${contextPack.name}» · ${contextPack.loader} ${contextPack.mc_version}`
            : 'Поиск и установка сборок, модов, ресурспаков и шейдеров'}
        </p>

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
              <div className={styles.cardMeta}>{r.author && `${r.author} · `}{formatCount(r.downloads)} загрузок</div>
              <div className={styles.cardDesc}>{r.description}</div>
            </div>
            <div className={styles.actions} onClick={e => e.stopPropagation()}>
              <button className={styles.installBtn} disabled={busyId === r.id} onClick={() => openInstall(r)}>
                {busyId === r.id ? '…' : type === 'modpack' ? (source === 'curseforge' ? 'На CurseForge ↗' : 'Установить') : 'Установить'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {installItem && type !== 'modpack' && (
        <InstallModal
          source={source}
          type={type}
          projectId={installItem.id}
          title={installItem.title}
          packs={packs}
          installPath={installPath}
          preferredPackId={contextPack?.id ?? null}
          onClose={() => setInstallItem(null)}
          showToast={showToast}
        />
      )}
    </main>
  )
}
