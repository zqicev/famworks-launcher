import { useState, useRef, useEffect } from 'react'
import styles from '../styles/Dropdown.module.css'

export interface DropdownOption {
  value: string
  label: string
  hint?: string
  disabled?: boolean
}

interface Props {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  title?: string
}

export default function Dropdown({ value, options, onChange, placeholder = 'Выбрать', disabled, title }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const selected = options.find(o => o.value === value)

  return (
    <div className={`${styles.wrap} ${open ? styles.wrapOpen : ''}`} ref={ref}>
      <button type="button" className={styles.trigger} disabled={disabled} title={title}
        onClick={() => { if (!disabled) setOpen(o => !o) }}>
        <span className={selected ? styles.value : styles.placeholder}>{selected?.label ?? placeholder}</span>
        <svg className={styles.chevron} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className={styles.menu}>
          {options.map(o => (
            <button
              type="button"
              key={o.value}
              className={`${styles.option} ${o.value === value ? styles.optionActive : ''}`}
              disabled={o.disabled}
              onClick={() => { if (!o.disabled) { onChange(o.value); setOpen(false) } }}
            >
              <span className={styles.optLabel}>
                {o.label}
                {o.hint && <span className={styles.optHint}>{o.hint}</span>}
              </span>
              {o.value === value && <span className={styles.tick}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
