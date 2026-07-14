import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Modpack } from '../../../types/modpack'
import styles from '../styles/ProjectDetail.module.css'

type Source = 'modrinth' | 'curseforge'
type CType = 'modpack' | 'mod' | 'resourcepack' | 'shader'
interface TargetPack { id: string; name: string; mc_version: string; loader: string }
const FOLDER: Record<Exclude<CType, 'modpack'>, string> = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }

type Detail = Awaited<ReturnType<typeof window.api.browser.project>>

interface Props {
  source: Source
  type: CType
  id: string
  target: TargetPack | null
  installPath: string
  onBack: () => void
  onImported: (mp: Modpack) => void
  showToast: (text: string, kind: 'info' | 'success' | 'error') => void
}

function fmt(n: number) { return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n) }

export default function ProjectDetail({ source, type, id, target, installPath, onBack, onImported, showToast }: Props) {
  const [data, setData] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [items, setItems] = useState<any[] | null>(null) // версии (Modrinth) или файлы (CF) для выбора
  const [chosen, setChosen] = useState('')
  const [busy, setBusy] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setData(null); setItems(null)
    window.api.browser.project(source, id, type)
      .then(d => { if (active) setData(d) })
      .catch(() => { if (active) setError('Не удалось загрузить страницу проекта') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [source, id, type])

  const openExternal = (url: string) => window.api.shell.openExternal(url)

  const installModpack = async () => {
    if (!data) return
    if (source === 'curseforge') { openExternal(data.webUrl); return }
    setBusy(true); showToast(`Установка «${data.title}»…`, 'info')
    try {
      const res = await window.api.browser.installModpack('modrinth', id)
      if (res.ok && res.modpack) { onImported(res.modpack); showToast(`Сборка «${res.modpack.name}» установлена`, 'success') }
      else showToast(res.error || 'Не удалось установить сборку', 'error')
    } catch (e) { showToast(`Ошибка: ${e instanceof Error ? e.message : String(e)}`, 'error') }
    finally { setBusy(false) }
  }

  const loadVersions = async () => {
    if (!target) { setError('Сначала выберите сборку для установки (в списке Браузера)'); return }
    setBusy(true); setError('')
    try {
      if (source === 'modrinth') {
        const vs = await window.api.modrinth.versions(id, target.mc_version, target.loader, type) as any[]
        setBusy(false)
        if (!vs.length) { setError(`Нет версий под ${target.loader} ${target.mc_version}`); return }
        setItems(vs); setChosen(vs[0].id)
      } else {
        const fs = (await window.api.curseforge.files(Number(id), target.mc_version, target.loader, type) as any[]).filter(f => f.downloadUrl)
        setBusy(false)
        if (!fs.length) { setError(`Нет файлов под ${target.loader} ${target.mc_version} (возможно, автор закрыл стороннюю раздачу)`); return }
        setItems(fs); setChosen(String(fs[0].id))
      }
    } catch { setBusy(false); setError('Ошибка загрузки версий') }
  }

  const download = () => {
    if (!items || !target || type === 'modpack' || !data) return
    const dir = `${installPath}/${target.id}/${FOLDER[type]}`
    if (source === 'modrinth') {
      const v = items.find(x => x.id === chosen) ?? items[0]
      const file = (v.files ?? []).find((f: any) => f.primary) ?? v.files?.[0]
      if (!file) { setError('У версии нет файла для скачивания'); return }
      window.api.modrinth.download(file.url, file.filename, dir, file.hashes?.sha512)
    } else {
      const f = items.find(x => String(x.id) === chosen) ?? items[0]
      if (!f?.downloadUrl) { setError('У файла нет прямой ссылки'); return }
      const sha1 = (f.hashes ?? []).find((h: any) => h.algo === 1)?.value
      window.api.curseforge.download(f.downloadUrl, f.fileName, dir, sha1)
    }
    setItems(null)
    showToast(`«${data.title}» добавляется в «${target.name}»`, 'success')
  }

  const optLabel = (item: any, i: number) => source === 'modrinth'
    ? `${item.version_number}${i === 0 ? ' (последняя)' : ''}`
    : `${item.displayName || item.fileName}${i === 0 ? ' (последняя)' : ''}`
  const optValue = (item: any) => source === 'modrinth' ? item.id : String(item.id)

  const backBtn = <button className={styles.back} onClick={onBack}>← Назад к списку</button>

  if (loading) return <main className={styles.main}><div className={styles.top}>{backBtn}</div><div className={styles.center}><div className={styles.spinner} /></div></main>
  if (error && !data) return <main className={styles.main}><div className={styles.top}>{backBtn}</div><div className={styles.center}><p className={styles.err}>{error}</p></div></main>
  if (!data) return null

  return (
    <main className={styles.main}>
      <div className={styles.top}>
        {backBtn}
        <button className={styles.siteLink} onClick={() => openExternal(data.webUrl)}>
          Открыть на {source === 'modrinth' ? 'Modrinth' : 'CurseForge'} ↗
        </button>
      </div>

      <div className={styles.scroll}>
        <div className={styles.hero}>
          <div className={styles.heroIcon}>
            {data.icon ? <img src={data.icon} alt="" /> : <span>{data.title[0]?.toUpperCase() ?? '?'}</span>}
          </div>
          <div className={styles.heroInfo}>
            <h1 className={styles.title}>{data.title}</h1>
            <div className={styles.meta}>
              {data.authors.length > 0 && <span>{data.authors.join(', ')}</span>}
              <span className={styles.dl}>{fmt(data.downloads)} загрузок</span>
              {data.followers != null && <span>{fmt(data.followers)} подписчиков</span>}
            </div>
            <p className={styles.summary}>{data.description}</p>
            {data.categories.length > 0 && (
              <div className={styles.chips}>{data.categories.slice(0, 10).map(c => <span key={c} className={styles.chip}>{c}</span>)}</div>
            )}
          </div>
          <div className={styles.actions}>
            {type === 'modpack' ? (
              <button className={styles.installBtn} disabled={busy} onClick={installModpack}>
                {busy ? '…' : source === 'curseforge' ? 'На CurseForge ↗' : 'Установить'}
              </button>
            ) : items ? (
              <div className={styles.picker}>
                <select className={styles.select} value={chosen} onChange={e => setChosen(e.target.value)}>
                  {items.map((it, i) => <option key={optValue(it)} value={optValue(it)}>{optLabel(it, i)}</option>)}
                </select>
                <button className={styles.installBtn} onClick={download}>Скачать</button>
              </div>
            ) : (
              <button className={styles.installBtn} disabled={busy} onClick={loadVersions}>{busy ? '…' : 'Установить'}</button>
            )}
            {target && type !== 'modpack' && <div className={styles.into}>в «{target.name}»</div>}
          </div>
        </div>

        {error && <div className={styles.notice}>{error}</div>}

        {data.links.length > 0 && (
          <div className={styles.links}>
            {data.links.map(l => <button key={l.url} className={styles.linkBtn} onClick={() => openExternal(l.url)}>{l.label} ↗</button>)}
          </div>
        )}

        {data.gallery.length > 0 && (
          <div className={styles.gallery}>
            {data.gallery.map(g => (
              <button key={g.url} className={styles.shot} onClick={() => setLightbox(g.url)} title={g.title}>
                <img src={g.url} alt={g.title ?? ''} loading="lazy" />
              </button>
            ))}
          </div>
        )}

        <div className={styles.columns}>
          <div className={styles.body}>
            {data.body ? (
              <div className={styles.markdown}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => <a onClick={e => { e.preventDefault(); if (href) openExternal(href) }}>{children}</a>,
                    img: ({ src, alt }) => <img src={src as string} alt={alt ?? ''} />
                  }}
                >{data.body}</ReactMarkdown>
              </div>
            ) : (
              <p className={styles.noBody}>
                {data.description}
                {source === 'curseforge' && <><br /><br />Полное описание доступно <a onClick={() => openExternal(data.webUrl)}>на странице CurseForge ↗</a>.</>}
              </p>
            )}
          </div>

          <aside className={styles.side}>
            {(data.gameVersions.length > 0 || data.loaders.length > 0) && (
              <div className={styles.sideBlock}>
                <div className={styles.sideTitle}>Совместимость</div>
                {data.loaders.length > 0 && <div className={styles.sideRow}>{data.loaders.join(', ')}</div>}
                {data.gameVersions.length > 0 && <div className={styles.sideDim}>{data.gameVersions.slice(0, 12).join(', ')}{data.gameVersions.length > 12 ? '…' : ''}</div>}
              </div>
            )}
            {data.dependencies.length > 0 && (
              <div className={styles.sideBlock}>
                <div className={styles.sideTitle}>Зависит от</div>
                {data.dependencies.map(d => (
                  <div key={d.slug} className={styles.dep}>
                    {d.icon && <img src={d.icon} alt="" />}<span>{d.name}</span>
                  </div>
                ))}
              </div>
            )}
            {data.license && (
              <div className={styles.sideBlock}>
                <div className={styles.sideTitle}>Лицензия</div>
                {data.license.url
                  ? <button className={styles.sideLink} onClick={() => openExternal(data.license!.url!)}>{data.license.name || 'Открыть'} ↗</button>
                  : <div className={styles.sideRow}>{data.license.name}</div>}
              </div>
            )}
            {(data.clientSide || data.serverSide) && (
              <div className={styles.sideBlock}>
                <div className={styles.sideTitle}>Сторона</div>
                <div className={styles.sideDim}>Клиент: {data.clientSide || '—'} · Сервер: {data.serverSide || '—'}</div>
              </div>
            )}
          </aside>
        </div>
      </div>

      {lightbox && (
        <div className={styles.lightbox} onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </main>
  )
}
