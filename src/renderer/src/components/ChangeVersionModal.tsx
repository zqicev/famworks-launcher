import { useState, useEffect } from 'react'
import Dropdown from './Dropdown'
import styles from '../styles/ChangeVersionModal.module.css'

type Decision = 'keep' | 'disable' | 'delete'
type Plan = Awaited<ReturnType<typeof window.api.version.plan>>

interface Props {
  packId: string
  loader: string
  currentMc: string
  onClose: () => void
  onApplied: () => void
  showToast: (text: string, kind: 'info' | 'success' | 'error') => void
}

const SOURCE_LABEL: Record<string, string> = { modrinth: 'Modrinth', curseforge: 'CurseForge', famworks: 'FamWorks', download: 'Прямая ссылка', local: 'Локальный' }
const KIND_LABEL: Record<string, string> = { mod: 'Мод', resourcepack: 'Ресурспак', shader: 'Шейдер' }

export default function ChangeVersionModal({ packId, loader, currentMc, onClose, onApplied, showToast }: Props): JSX.Element {
  const [versions, setVersions] = useState<string[]>([])
  const [newMc, setNewMc] = useState('')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [planning, setPlanning] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      let vs = await window.api.mcVersions(loader).catch(() => [] as string[])
      // Мета загрузчика недоступна → показываем полный список релизов (совместимость проверит «Проверить»).
      if (!vs.length) vs = await window.api.mcVersions().catch(() => [] as string[])
      if (!alive) return
      setVersions(vs)
      setNewMc(vs.find(v => v !== currentMc) ?? vs[0] ?? '')
    })()
    return () => { alive = false }
  }, [loader, currentMc])

  // Смена выбранной версии сбрасывает устаревший план.
  const pickMc = (v: string): void => { setNewMc(v); setPlan(null); setConfirmDel(false) }

  const runPlan = async (): Promise<void> => {
    if (!newMc || newMc === currentMc) return
    setPlanning(true); setPlan(null); setConfirmDel(false)
    try {
      const p = await window.api.version.plan(packId, newMc)
      setPlan(p)
      const d: Record<string, Decision> = {}
      for (const it of p.items) if (!it.compatible) d[`${it.kind}:${it.id}`] = 'keep'
      setDecisions(d)
    } catch (e) {
      showToast(`Не удалось проверить совместимость: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally { setPlanning(false) }
  }

  // Закрываем модалку сразу — ход миграции (может быть долгой) показывает нижняя панель + тосты.
  const apply = (): void => {
    if (!plan || !canApply) return
    const p = plan
    const d = decisions
    onClose()
    showToast(`Смена версии на ${p.newMc}…`, 'info')
    window.api.version.apply(packId, p, d)
      .then(r => {
        if (r.ok) { showToast(`Версия изменена на ${p.newMc}. Нажмите «Установить», чтобы докачать загрузчик.`, 'success'); onApplied() }
        else showToast(r.error || 'Не удалось применить', 'error')
      })
      .catch(e => showToast(`Ошибка: ${e instanceof Error ? e.message : String(e)}`, 'error'))
  }

  const incompatible = plan?.items.filter(i => !i.compatible) ?? []
  const compatible = plan?.items.filter(i => i.compatible) ?? []
  const toDelete = Object.values(decisions).filter(d => d === 'delete').length
  const canApply = !!plan && (toDelete === 0 || confirmDel)
  const options = versions.map(v => ({ value: v, label: v === currentMc ? `${v} (текущая)` : v }))

  return (
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Сменить версию Minecraft</h2>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          <div className={styles.pickRow}>
            <span className={styles.mcBadge}>{currentMc}</span>
            <span className={styles.arrow}>→</span>
            <div className={styles.dd}><Dropdown value={newMc} options={options} onChange={pickMc} /></div>
            <button className={styles.checkBtn} onClick={runPlan} disabled={planning || !newMc || newMc === currentMc}>
              {planning ? 'Проверка…' : 'Проверить'}
            </button>
          </div>

          {!plan && (
            <p className={styles.hint}>Моды, ресурспаки и шейдеры будут переустановлены под новую версию. Что не переедет - выберете сами.</p>
          )}

          {plan && (
            <>
              <div className={styles.summary}>
                <span className={styles.ok}>✓ Переедут: {compatible.length} из {plan.items.length}</span>
                {incompatible.length > 0 && <span className={styles.bad}>✕ Не смогут: {incompatible.length}</span>}
              </div>
              <div className={styles.breakdown}>
                {(['mod', 'resourcepack', 'shader'] as const).map(k => {
                  const all = plan.items.filter(i => i.kind === k)
                  if (!all.length) return null
                  const ok = all.filter(i => i.compatible).length
                  const label = k === 'mod' ? 'Моды' : k === 'resourcepack' ? 'Ресурспаки' : 'Шейдеры'
                  return <span key={k}>{label}: {ok}/{all.length}</span>
                })}
              </div>

              {incompatible.length === 0 ? (
                <p className={styles.hint}>Все ресурсы совместимы с {plan.newMc}. Можно применять.</p>
              ) : (
                <>
                  <div className={styles.label}>Эти ресурсы нельзя перенести на {plan.newMc}. Что с ними сделать?</div>
                  <div className={styles.list}>
                    {incompatible.map(it => {
                      const key = `${it.kind}:${it.id}`
                      const d = decisions[key] ?? 'keep'
                      return (
                        <div key={key} className={styles.item}>
                          <div className={styles.itemInfo}>
                            <span className={styles.itemName}>{it.name}</span>
                            <span className={styles.itemMeta}>{KIND_LABEL[it.kind]} · {SOURCE_LABEL[it.source] ?? it.source}</span>
                          </div>
                          <div className={styles.seg}>
                            {(['keep', 'disable', 'delete'] as Decision[]).map(opt => (
                              <button
                                key={opt}
                                className={`${styles.segBtn} ${d === opt ? (opt === 'delete' ? styles.segDanger : styles.segOn) : ''}`}
                                onClick={() => { setDecisions(prev => ({ ...prev, [key]: opt })); if (opt !== 'delete') setConfirmDel(false) }}
                              >{opt === 'keep' ? 'Оставить' : opt === 'disable' ? 'Отключить' : 'Удалить'}</button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {toDelete > 0 && (
                    <label className={styles.confirm}>
                      <input type="checkbox" checked={confirmDel} onChange={e => setConfirmDel(e.target.checked)} />
                      ⚠ Понимаю: {toDelete} файл(ов) будут удалены безвозвратно
                    </label>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.ghost} onClick={onClose}>Отмена</button>
          <button className={styles.accent} onClick={apply} disabled={!canApply}>
            {toDelete > 0 ? `Применить и удалить (${toDelete})` : 'Применить'}
          </button>
        </div>
      </div>
    </div>
  )
}
