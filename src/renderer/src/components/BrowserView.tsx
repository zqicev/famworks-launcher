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
  initialDetail?: { source: Source; id: string } | null // открыть сразу на странице проекта
  onBackToCaller?: () => void // «назад» со стартовой страницы проекта → туда, откуда пришли (не в поиск)
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
  // Для источника FamWorks: данные для установки в локальную сборку.
  fwKind?: 'mod' | 'resourcepack' | 'shader'
  fwFilename?: string
  fwVersion?: string
  fwSize?: number
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

export default function BrowserView({ installPath, packs, contextPack, initialType, initialDetail, onBackToCaller, onImported, showToast }: Props) {
  const [source, setSource] = useState<Source>(initialDetail?.source ?? 'modrinth')
  const [type, setType] = useState<ContentType>(initialType)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(initialDetail?.id ?? null)
  const [installItem, setInstallItem] = useState<{ id: string; title: string } | null>(null)
  const [fwCatalog, setFwCatalog] = useState(false) // показывать источник FamWorks (право «Каталог»)
  const [fwPick, setFwPick] = useState<Hit | null>(null) // выбор локальной сборки для установки из FamWorks
  const reqRef = useRef(0) // токен запроса — отбрасываем устаревшие ответы при быстром переключении
  const typingTimer = useRef<ReturnType<typeof setTimeout>>() // пауза живого поиска
  const lastFilter = useRef<string | null>(null) // источник+тип прошлого запроса: отличаем их смену от набора текста

  const customPacks = packs.filter(p => p.id.startsWith('custom-'))

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
      } else if (source === 'curseforge') {
        const hits = await window.api.curseforge.search(q, mc, loader, type) as any[]
        mapped = hits.map(h => ({
          id: String(h.id), title: h.name, description: h.summary, author: h.authors?.[0]?.name ?? '',
          downloads: h.downloadCount, icon: h.logo?.thumbnailUrl ?? null,
          url: h.links?.websiteUrl ?? `https://www.curseforge.com/minecraft/${h.slug ?? ''}`
        }))
      } else {
        // FamWorks: каталог наших модов/паков/шейдеров (без сборок).
        const kind = type === 'modpack' ? 'mod' : type
        const items = await window.api.famworks.catalog({ mc_version: mc, loader, kind, q })
        mapped = items.map(it => {
          const file = it.release?.files?.find(f => f.primary) ?? it.release?.files?.[0]
          return {
            id: it.id, title: it.name, description: it.description ?? '', author: 'FamWorks', downloads: 0,
            icon: null, url: '', fwKind: it.kind,
            fwFilename: file?.filename, fwVersion: it.release?.version_number,
            fwSize: file ? Math.round(file.size / 1024 / 1024 * 100) / 100 : 0
          }
        })
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

  // Право «Каталог модов в лаунчере» — показывать источник FamWorks.
  useEffect(() => {
    window.api.famworks.access().then(a => setFwCatalog(!!a.paired && !!a.catalog)).catch(() => {})
  }, [])

  // У FamWorks нет «сборок» — переключаемся на моды.
  useEffect(() => {
    if (source === 'famworks' && type === 'modpack') setType('mod')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  // Популярное при открытии; при смене источника/типа - сразу; пока печатают запрос - живой поиск
  // с паузой, чтобы не дёргать API на каждую букву (устаревшие ответы отбрасывает reqRef).
  useEffect(() => {
    const filter = `${source}|${type}`
    const typing = lastFilter.current === filter
    lastFilter.current = filter
    if (!typing) { load(); return }
    typingTimer.current = setTimeout(() => load(), 350)
    return () => clearTimeout(typingTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, type, query])

  // Enter / «Найти» - искать сразу, не дожидаясь паузы.
  const searchNow = (): void => { clearTimeout(typingTimer.current); load() }

  const installFamworksInto = async (hit: Hit, packId: string) => {
    setFwPick(null)
    setBusyId(hit.id)
    showToast(`Установка «${hit.title}»…`, 'info')
    try {
      const res = await window.api.famworks.addToPack(packId, {
        famworks_id: hit.id, name: hit.title, kind: hit.fwKind ?? 'mod',
        filename: hit.fwFilename, version: hit.fwVersion, size_mb: hit.fwSize
      })
      if (res.ok && res.modpack) { onImported(res.modpack); showToast(`«${hit.title}» добавлен в сборку`, 'success') }
      else showToast(res.error || 'Не удалось добавить', 'error')
    } catch (e) {
      showToast(`Ошибка: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setBusyId(null)
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

  const openInstall = (hit: Hit) => {
    if (source === 'famworks') {
      if (customPacks.length === 0) { setNotice('Каталог FamWorks ставится только в свою локальную сборку — сначала создайте её.'); return }
      if (contextPack && contextPack.id.startsWith('custom-')) { installFamworksInto(hit, contextPack.id); return }
      if (customPacks.length === 1) { installFamworksInto(hit, customPacks[0].id); return }
      setFwPick(hit); return
    }
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
        onBack={() => {
          // Если это стартовая страница (открыли по ссылке из сборки) — вернуться туда, откуда пришли.
          if (initialDetail && detailId === initialDetail.id && onBackToCaller) onBackToCaller()
          else setDetailId(null)
        }}
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
            {TYPES.filter(t => source !== 'famworks' || t.key !== 'modpack').map(t => (
              <button key={t.key} className={`${styles.segBtn} ${type === t.key ? styles.segOn : ''}`} onClick={() => setType(t.key)}>{t.label}</button>
            ))}
          </div>
          <div className={styles.seg}>
            <button className={`${styles.segBtn} ${source === 'modrinth' ? styles.segOn : ''}`} onClick={() => setSource('modrinth')}>Modrinth</button>
            <button className={`${styles.segBtn} ${source === 'curseforge' ? styles.segOn : ''}`} onClick={() => setSource('curseforge')}>CurseForge</button>
            {fwCatalog && (
              <button className={`${styles.segBtn} ${source === 'famworks' ? styles.segOn : ''}`} onClick={() => setSource('famworks')}>FamWorks</button>
            )}
          </div>
        </div>

        <div className={styles.searchRow}>
          <input className={styles.input} placeholder={`Поиск на ${source === 'modrinth' ? 'Modrinth' : source === 'curseforge' ? 'CurseForge' : 'FamWorks'}…`}
            value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchNow()} autoFocus />
          <button className={styles.searchBtn} onClick={searchNow}>Найти</button>
        </div>
        {notice && <div className={styles.notice}>{notice}</div>}
      </div>

      <div className={styles.results}>
        {loading && <div className={styles.hint}>Загрузка…</div>}
        {!loading && results.length === 0 && <div className={styles.hint}>Ничего не найдено</div>}
        {results.map(r => (
          <div key={r.id} className={styles.card} onClick={() => source !== 'famworks' && setDetailId(r.id)} title={source === 'famworks' ? '' : 'Открыть страницу'}>
            <div className={styles.icon}><Icon src={r.icon} title={r.title} /></div>
            <div className={styles.cardInfo}>
              <div className={styles.cardName}>{r.title}</div>
              <div className={styles.cardMeta}>
                {source === 'famworks'
                  ? (r.fwVersion ? `FamWorks · ${r.fwVersion}` : 'FamWorks')
                  : <>{r.author && `${r.author} · `}{formatCount(r.downloads)} загрузок</>}
              </div>
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

      {installItem && type !== 'modpack' && source !== 'famworks' && (
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

      {fwPick && (
        <div
          onMouseDown={e => { if (e.target === e.currentTarget) setFwPick(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
        >
          <div style={{ width: 360, maxWidth: '90vw', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>Добавить «{fwPick.title}»</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>В какую локальную сборку?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {customPacks.map(p => (
                <button
                  key={p.id}
                  onClick={() => installFamworksInto(fwPick, p.id)}
                  style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 8, background: 'var(--bg-active)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13 }}
                >
                  {p.name} <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>· {p.loader} {p.mc_version}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
