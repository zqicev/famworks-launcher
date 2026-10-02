import { useState, useRef, useEffect } from 'react'
import { formatGb } from '../lib/memory'
import styles from '../styles/MemorySelect.module.css'

interface Props {
  value: number          // в МБ
  options: number[]      // в МБ
  safeMax?: number       // выше этого (МБ) - предупреждаем о риске вылета
  disabled?: boolean
  onChange: (mb: number) => void
}

export default function MemorySelect({ value, options, safeMax, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const label = (mb: number) => `${mb / 1024} ГБ`
  const risky = (mb: number) => safeMax !== undefined && mb > safeMax
  const recommended = options.filter(mb => !risky(mb)).pop()

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        className={styles.trigger}
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        title={risky(value) ? 'Слишком много памяти для этой системы - игра может вылетать' : undefined}
      >
        <span className={`${styles.value} ${risky(value) ? styles.valueWarn : ''}`}>
          {risky(value) && <span className={styles.warnIcon}>⚠</span>}
          {label(value)}
        </span>
        <span className={styles.chevron}>{open ? '∧' : '∨'}</span>
      </button>

      {open && (
        <div className={styles.menu}>
          {options.map(mb => (
            <button
              key={mb}
              className={`${styles.option} ${mb === value ? styles.optionActive : ''} ${risky(mb) ? styles.optionWarn : ''}`}
              onClick={() => { onChange(mb); setOpen(false) }}
            >
              {label(mb)}
              {mb === value ? <span className={styles.tick}>✓</span> : risky(mb) && <span className={styles.warnIcon}>⚠</span>}
            </button>
          ))}
          {recommended !== undefined && options.some(risky) && (
            <div className={styles.note}>
              Больше {formatGb(recommended)} ГБ - риск вылета: Windows и драйверу видеокарты не хватит памяти
            </div>
          )}
        </div>
      )}
    </div>
  )
}
