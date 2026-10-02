import { useState, useEffect } from 'react'
import SkinHead from './SkinHead'
import { safeMemoryMb, formatGb, formatRamGb } from '../lib/memory'
import styles from '../styles/SettingsModal.module.css'

interface Account {
  id: string
  username: string
  type: 'offline' | 'microsoft' | 'ely'
  uuid?: string
}

interface Props {
  memoryMb: number
  runningMb: number   // ОЗУ, уже отданное запущенным экземплярам (всех сборок)
  totalRamMb: number
  onPick: (accountId: string) => void
  onClose: () => void
}

const TYPE_LABEL: Record<Account['type'], string> = { offline: 'ОФФЛАЙН', ely: 'ELY.BY', microsoft: 'MICROSOFT' }

/** Запуск ещё одного экземпляра: предупреждение про ОЗУ + выбор аккаунта, под которым запустить. */
export default function LaunchAccountModal({ memoryMb, runningMb, totalRamMb, onPick, onClose }: Props): JSX.Element {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [heads, setHeads] = useState<Record<string, string>>({})

  useEffect(() => {
    window.api.store.get('accounts').then(a => setAccounts((a as Account[]) ?? [])).catch(() => {})
    window.api.store.get('activeAccountId').then(id => setActiveId((id as string) ?? null)).catch(() => {})
  }, [])

  useEffect(() => {
    for (const a of accounts) {
      if (a.type === 'microsoft' && a.uuid && !(a.uuid in heads)) {
        const uuid = a.uuid
        window.api.skin.head(uuid).then(url => { if (url) setHeads(p => ({ ...p, [uuid]: url })) }).catch(() => {})
      }
    }
  }, [accounts])

  const gb = formatGb(memoryMb)
  const totalAfter = runningMb + memoryMb
  const risky = totalAfter > safeMemoryMb(totalRamMb)

  return (
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.modal} style={{ width: 420, maxWidth: '92vw' }} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Ещё один экземпляр</h2>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>
        <div className={styles.body} style={{ gap: 12 }}>
          <p className={styles.hint} style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Каждый экземпляр получит <b style={{ color: 'var(--text)' }}>{gb} ГБ</b> ОЗУ. Несколько копий Minecraft
            сразу ощутимо нагружают память и процессор - запускайте с запасом. Под каким аккаунтом запустить новый?
          </p>
          {risky && (
            <div style={{
              padding: '8px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.5, color: '#e0b341',
              background: 'rgba(224, 179, 65, 0.08)', border: '1px solid rgba(224, 179, 65, 0.35)'
            }}>
              ⚠ Вместе с уже запущенными будет {formatGb(totalAfter)} ГБ из {formatRamGb(totalRamMb)} ГБ ОЗУ -
              высокий риск вылета. Уменьшите память сборки или закройте лишний экземпляр.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {accounts.length === 0 && (
              <div className={styles.hint} style={{ margin: 0 }}>Нет аккаунтов — добавьте в панели аккаунта.</div>
            )}
            {accounts.map(a => (
              <button
                key={a.id}
                onClick={() => onPick(a.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: 10, textAlign: 'left',
                  background: 'var(--bg-active)', border: '1px solid var(--border)', color: 'var(--text)'
                }}
              >
                <div style={{
                  width: 34, height: 34, borderRadius: 8, overflow: 'hidden', flexShrink: 0, fontWeight: 700,
                  background: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  {a.type === 'microsoft' && a.uuid && heads[a.uuid]
                    ? <SkinHead url={heads[a.uuid]} />
                    : (a.username[0]?.toUpperCase() ?? '?')}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.username}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: 0.5 }}>
                    {TYPE_LABEL[a.type]}{a.id === activeId ? ' · активный' : ''}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  )
}
