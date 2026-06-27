import { useState, useRef, useEffect } from 'react'
import styles from '../styles/MemorySelect.module.css'

interface Props {
  value: number          // в МБ
  options: number[]      // в МБ
  disabled?: boolean
  onChange: (mb: number) => void
}

export default function MemorySelect({ value, options, disabled, onChange }: Props) {
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

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        className={styles.trigger}
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
      >
        <span className={styles.value}>{label(value)}</span>
        <span className={styles.chevron}>{open ? '∧' : '∨'}</span>
      </button>

      {open && (
        <div className={styles.menu}>
          {options.map(mb => (
            <button
              key={mb}
              className={`${styles.option} ${mb === value ? styles.optionActive : ''}`}
              onClick={() => { onChange(mb); setOpen(false) }}
            >
              {label(mb)}
              {mb === value && <span className={styles.tick}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
