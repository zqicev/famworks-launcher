import { useState } from 'react'
import styles from '../styles/CrashModal.module.css'

export interface CrashData {
  modpackId: string
  category: 'dependency' | 'conflict' | 'memory' | 'java' | 'mod-bug' | 'unknown'
  title: string
  detail: string
  culprit?: string
  reportPath?: string
  copyText: string
  fix?: { kind: string; label: string; query?: string; version?: string; mod?: string }
}

const CAT: Record<CrashData['category'], { label: string; cls: string }> = {
  dependency: { label: 'Зависимости', cls: 'catDep' },
  conflict: { label: 'Конфликт модов', cls: 'catConf' },
  memory: { label: 'Память', cls: 'catWarn' },
  java: { label: 'Java', cls: 'catWarn' },
  'mod-bug': { label: 'Ошибка мода', cls: 'catErr' },
  unknown: { label: 'Неизвестно', cls: 'catUnk' }
}

export default function CrashModal({ data, onClose }: { data: CrashData; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const [fixState, setFixState] = useState<'idle' | 'applying' | 'done' | 'error'>('idle')
  const [fixMsg, setFixMsg] = useState('')
  const cat = CAT[data.category]

  const copy = async () => {
    try { await navigator.clipboard.writeText(data.copyText); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* noop */ }
  }

  const tryFix = async () => {
    if (!data.fix) return
    setFixState('applying'); setFixMsg('')
    const r = await window.api.crash.applyFix(data.modpackId, data.fix)
    if (r.ok) { setFixState('done'); setFixMsg(r.message ?? 'Готово') }
    else { setFixState('error'); setFixMsg(r.error ?? 'Не удалось') }
  }

  const relaunch = () => { window.api.launch.start(data.modpackId); onClose() }

  return (
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.top}>
          <span className={`${styles.badge} ${styles[cat.cls]}`}>{cat.label}</span>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <h2 className={styles.title}>{data.title}</h2>
        <p className={styles.detail}>{data.detail}</p>

        {data.culprit && (
          <div className={styles.culprit}>
            <span className={styles.culpritLabel}>Вероятный виновник</span>
            <span className={styles.culpritName}>{data.culprit}</span>
          </div>
        )}

        {data.fix && fixState !== 'done' && (
          <div className={styles.fixBox}>
            <div className={styles.fixText}>Возможное решение: <b>{data.fix.label}</b></div>
            <button className={styles.fixBtn} onClick={tryFix} disabled={fixState === 'applying'}>
              {fixState === 'applying' ? 'Чиню…' : 'Попробовать решить'}
            </button>
          </div>
        )}
        {fixState === 'error' && <div className={styles.fixErr}>{fixMsg}</div>}
        {fixState === 'done' && (
          <div className={styles.fixOk}>
            <span>✓ {fixMsg}</span>
            <button className={styles.fixBtn} onClick={relaunch}>Запустить снова</button>
          </div>
        )}

        <div className={styles.actions}>
          {data.reportPath && (
            <button className={styles.btn} onClick={() => window.api.crash.openReport(data.reportPath!)}>Открыть crash-report</button>
          )}
          <button className={styles.btn} onClick={copy}>{copied ? 'Скопировано' : 'Скопировать лог'}</button>
          <button className={styles.btnPrimary} onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  )
}
