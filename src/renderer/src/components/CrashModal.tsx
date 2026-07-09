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
  const cat = CAT[data.category]

  const copy = async () => {
    try { await navigator.clipboard.writeText(data.copyText); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* noop */ }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
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

        {data.fix && (
          <div className={styles.fixHint}>
            Возможное решение: <b>{data.fix.label}</b> <span className={styles.soon}>— авто-починка скоро</span>
          </div>
        )}

        <div className={styles.actions}>
          {data.reportPath && (
            <button className={styles.btn} onClick={() => window.api.crash.openReport(data.reportPath!)}>Открыть crash-report</button>
          )}
          <button className={styles.btn} onClick={copy}>{copied ? 'Скопировано' : 'Скопировать лог'}</button>
          <button className={styles.btnPrimary} onClick={onClose}>Понятно</button>
        </div>
      </div>
    </div>
  )
}
