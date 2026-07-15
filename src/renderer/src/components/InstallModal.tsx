import { useState, useEffect } from 'react'
import Dropdown from './Dropdown'
import { Source, InstallableType, TargetPack } from '../lib/browser'
import styles from '../styles/InstallModal.module.css'

interface Props {
  source: Source
  type: InstallableType
  projectId: string
  title: string
  packs: TargetPack[]
  installPath: string
  preferredPackId?: string | null
  onClose: () => void
  showToast: (text: string, kind: 'info' | 'success' | 'error') => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface CompatPack { pack: TargetPack; items: any[] }

export default function InstallModal({ source, type, projectId, title, packs, installPath, preferredPackId, onClose, showToast }: Props) {
  const [loading, setLoading] = useState(true)
  const [compat, setCompat] = useState<CompatPack[]>([])
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null)
  const [chosen, setChosen] = useState('')
  const [installing, setInstalling] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itemId = (it: any) => source === 'modrinth' ? it.id : String(it.id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itemLabel = (it: any) => source === 'modrinth' ? it.version_number : (it.displayName || it.fileName)

  // Проверяем каждую сборку: есть ли под неё совместимая версия. Показываем только те, куда подойдёт.
  useEffect(() => {
    let active = true
    setLoading(true)
    ;(async () => {
      const results = await Promise.all(packs.map(async (pack): Promise<CompatPack> => {
        try {
          if (source === 'modrinth') {
            const vs = await window.api.modrinth.versions(projectId, pack.mc_version, pack.loader, type) as any[]
            return { pack, items: vs }
          }
          const fs = (await window.api.curseforge.files(Number(projectId), pack.mc_version, pack.loader, type) as any[]).filter(f => f.downloadUrl)
          return { pack, items: fs }
        } catch {
          return { pack, items: [] }
        }
      }))
      if (!active) return
      const ok = results.filter(r => r.items.length > 0)
      setCompat(ok)
      const pref = ok.find(r => r.pack.id === preferredPackId) ?? ok[0]
      if (pref) { setSelectedPackId(pref.pack.id); setChosen(itemId(pref.items[0])) }
      setLoading(false)
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const current = compat.find(c => c.pack.id === selectedPackId) ?? null
  const versionOptions = (current?.items ?? []).map((it, i) => ({
    value: itemId(it),
    label: itemLabel(it),
    hint: i === 0 ? 'последняя' : undefined
  }))

  const selectPack = (id: string) => {
    setSelectedPackId(id)
    const c = compat.find(x => x.pack.id === id)
    if (c) setChosen(itemId(c.items[0]))
  }

  const install = async () => {
    if (!current || !chosen) return
    setInstalling(true)
    showToast(`Установка «${title}»…`, 'info')
    try {
      const packRoot = `${installPath}/${current.pack.id}`
      const res = await window.api.browser.install(source, type, projectId, chosen, current.pack.mc_version, current.pack.loader, packRoot)
      if (res.ok) {
        const n = res.installed.length
        showToast(n > 1 ? `«${title}» и зависимости установлены (${n} файлов) в «${current.pack.name}»` : `«${title}» установлен в «${current.pack.name}»`, 'success')
        onClose()
      } else {
        showToast(res.error || 'Не удалось установить', 'error')
      }
    } catch (e) {
      showToast(`Ошибка: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Установить <span className={styles.name}>«{title}»</span></h2>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          {loading ? (
            <div className={styles.center}><div className={styles.spinner} /></div>
          ) : compat.length === 0 ? (
            <p className={styles.empty}>Нет сборок, куда это подойдёт.<br />Нужна сборка с подходящей версией Minecraft и загрузчиком.</p>
          ) : (
            <>
              <div className={styles.label}>Куда установить</div>
              <div className={styles.packList}>
                {compat.map(({ pack }) => (
                  <button key={pack.id} className={`${styles.packRow} ${pack.id === selectedPackId ? styles.packActive : ''}`} onClick={() => selectPack(pack.id)}>
                    <div className={styles.packAvatar}>{pack.name[0]?.toUpperCase() ?? '?'}</div>
                    <div className={styles.packInfo}>
                      <div className={styles.packName}>{pack.name}</div>
                      <div className={styles.packMeta}>{pack.loader} · {pack.mc_version}</div>
                    </div>
                    <span className={styles.radio}>{pack.id === selectedPackId && <span className={styles.radioDot} />}</span>
                  </button>
                ))}
              </div>

              <div className={styles.label}>Версия</div>
              <Dropdown value={chosen} options={versionOptions} onChange={setChosen} />
            </>
          )}
        </div>

        {!loading && compat.length > 0 && (
          <div className={styles.footer}>
            <button className={styles.cancelBtn} onClick={onClose}>Отмена</button>
            <button className={styles.installBtn} onClick={install} disabled={installing || !chosen}>{installing ? 'Установка…' : 'Установить'}</button>
          </div>
        )}
      </div>
    </div>
  )
}
