import { useEffect, useMemo, useState } from 'react'
import sm from '../styles/SettingsModal.module.css'
import st from '../styles/ExportModal.module.css'
import { formatBytes } from '../lib/format'

type Mark = 'in' | 'out'
interface DirEntry { name: string; isDir: boolean; size: number; mtime: number }

interface Props {
  packId: string
  packName: string
  showToast: (text: string, kind: 'info' | 'success' | 'error') => void
  onClose: () => void
}

// Отметки по умолчанию: игровой контент, который обычно и переносят между машинами.
const DEFAULT_MARKS: Record<string, Mark> = { mods: 'in', resourcepacks: 'in', shaderpacks: 'in' }

const FolderIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
)
const FileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" />
  </svg>
)
const ChevronIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

/** Эффективная отметка пути: ближайший предок-или-он-сам с явной отметкой; иначе 'out'. */
function resolveMark(rel: string, marks: Record<string, Mark>): Mark {
  let p = rel
  for (;;) {
    if (marks[p]) return marks[p]
    const i = p.lastIndexOf('/')
    if (i < 0) return 'out'
    p = p.slice(0, i)
  }
}

/** Есть ли под путём хоть одна явная отметка (поддерево «смешанное»). */
function hasDescendantMark(rel: string, marks: Record<string, Mark>): boolean {
  const prefix = rel + '/'
  return Object.keys(marks).some(k => k.startsWith(prefix))
}

type CheckState = 'full' | 'partial' | 'empty'
function itemState(rel: string, isDir: boolean, marks: Record<string, Mark>): CheckState {
  const eff = resolveMark(rel, marks)
  if (!isDir) return eff === 'in' ? 'full' : 'empty'
  if (hasDescendantMark(rel, marks)) return 'partial'
  return eff === 'in' ? 'full' : 'empty'
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}, ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function ExportModal({ packId, packName, showToast, onClose }: Props) {
  const [marks, setMarks] = useState<Record<string, Mark>>(DEFAULT_MARKS)
  const [cwd, setCwd] = useState('') // '' = корень сборки
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    window.api.modpacks
      .listDir(packId, cwd)
      .then(list => { if (alive) { setEntries(list); setLoading(false) } })
      .catch(() => { if (alive) { setEntries([]); setLoading(false) } })
    return () => { alive = false }
  }, [packId, cwd])

  const anySelected = useMemo(() => Object.values(marks).includes('in'), [marks])

  // Включить/выключить путь. Убираем вложенные отметки (стали лишними) и не храним отметку,
  // совпадающую с эффективной у родителя (иначе множились бы избыточные записи).
  function apply(rel: string, newVal: Mark): void {
    setMarks(prev => {
      const next: Record<string, Mark> = {}
      const prefix = rel + '/'
      for (const [k, v] of Object.entries(prev)) {
        if (k === rel || k.startsWith(prefix)) continue
        next[k] = v
      }
      const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
      if (newVal !== resolveMark(parent, next)) next[rel] = newVal
      return next
    })
  }

  function toggle(rel: string, isDir: boolean): void {
    const cur = itemState(rel, isDir, marks)
    apply(rel, cur === 'empty' ? 'in' : 'out') // full/partial → выключаем, empty → включаем
  }

  async function doExport(): Promise<void> {
    setExporting(true)
    try {
      const res = await window.api.modpacks.exportSelected(packId, marks)
      if (res.cancelled) { setExporting(false); return } // диалог сохранения отменён — остаёмся в модалке
      if (res.ok) { showToast('Сборка сохранена в файл', 'success'); onClose() }
      else { showToast('Не удалось сохранить сборку', 'error'); setExporting(false) }
    } catch (e) {
      showToast(`Ошибка экспорта: ${e instanceof Error ? e.message : String(e)}`, 'error')
      setExporting(false)
    }
  }

  const segments = cwd ? cwd.split('/') : []

  return (
    <div className={sm.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={sm.modal} style={{ width: 640, maxWidth: '92vw' }} onClick={e => e.stopPropagation()}>
        <div className={sm.header}>
          <h2 className={sm.title}>Экспорт сборки</h2>
          <button className={sm.close} onClick={onClose}>✕</button>
        </div>

        {/* Хлебные крошки */}
        <div className={st.crumbs}>
          <button className={`${st.crumb} ${cwd === '' ? st.crumbCur : ''}`} onClick={() => setCwd('')} title={packName}>
            {packName || 'Сборка'}
          </button>
          {segments.map((seg, i) => {
            const path = segments.slice(0, i + 1).join('/')
            const isLast = i === segments.length - 1
            return (
              <span key={path} style={{ display: 'inline-flex', alignItems: 'center' }}>
                <span className={st.crumbSep}>›</span>
                <button className={`${st.crumb} ${isLast ? st.crumbCur : ''}`} onClick={() => setCwd(path)}>{seg}</button>
              </span>
            )
          })}
        </div>

        {/* Список файлов/папок */}
        <div className={st.list}>
          {loading ? (
            <div className={st.empty}>Загрузка…</div>
          ) : entries.length === 0 ? (
            <div className={st.empty}>{cwd ? 'Папка пуста' : 'Сборка ещё не установлена — переносить нечего'}</div>
          ) : (
            entries.map(e => {
              const rel = cwd ? `${cwd}/${e.name}` : e.name
              const state = itemState(rel, e.isDir, marks)
              return (
                <div
                  key={e.name}
                  className={`${st.row} ${e.isDir ? st.rowDir : ''}`}
                  onClick={e.isDir ? () => setCwd(rel) : undefined}
                >
                  <button
                    className={`${st.check} ${state === 'full' ? st.checkFull : state === 'partial' ? st.checkPartial : ''}`}
                    onClick={ev => { ev.stopPropagation(); toggle(rel, e.isDir) }}
                    title={state === 'empty' ? 'Добавить в экспорт' : 'Убрать из экспорта'}
                  >
                    {state === 'full' && <span className={st.checkMark}>✓</span>}
                    {state === 'partial' && <span className={st.checkDash} />}
                  </button>
                  <span className={`${st.icon} ${e.isDir ? st.iconDir : st.iconFile}`}>
                    {e.isDir ? <FolderIcon /> : <FileIcon />}
                  </span>
                  <span className={st.name}>{e.name}</span>
                  {!e.isDir && <span className={st.meta}>{formatBytes(e.size)}</span>}
                  <span className={st.meta}>{fmtDate(e.mtime)}</span>
                  {e.isDir && <span className={st.chev}><ChevronIcon /></span>}
                </div>
              )
            })
          )}
        </div>

        <div className={st.footerRow}>
          <span className={st.summary}>
            {anySelected ? 'modpack.json добавится автоматически' : 'Ничего не выбрано'}
          </span>
          <div className={st.footerBtns}>
            <button className={sm.cancelBtn} onClick={onClose}>Отмена</button>
            <button className={sm.saveBtn} disabled={!anySelected || exporting} onClick={doExport}>
              {exporting ? 'Экспорт…' : 'Экспортировать'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
