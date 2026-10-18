import { useState, useRef, useEffect, CSSProperties } from 'react'
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
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const close = () => setOpen(false)
    // Скролл закрывает меню только если скроллят НЕ само меню (оно со своим overflow-y).
    const onScroll = (e: Event) => { if (!ref.current || !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', onScroll, true) // capture: ловим скролл любого контейнера
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  // Меню позиционируем fixed по триггеру — чтобы не обрезалось overflow'ом модалок/панелей.
  const toggle = () => {
    if (disabled) return
    if (open) { setOpen(false); return }
    const el = triggerRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      const gap = 6
      const below = window.innerHeight - r.bottom - gap - 8
      const above = r.top - gap - 8
      const up = below < 200 && above > below
      const maxHeight = Math.max(120, Math.min(260, up ? above : below))
      setMenuStyle({
        position: 'fixed',
        left: r.left,
        width: r.width,
        maxHeight,
        zIndex: 1000,
        ...(up ? { bottom: window.innerHeight - r.top + gap } : { top: r.bottom + gap })
      })
    }
    setOpen(true)
  }

  const selected = options.find(o => o.value === value)

  return (
    <div className={`${styles.wrap} ${open ? styles.wrapOpen : ''}`} ref={ref}>
      <button type="button" ref={triggerRef} className={styles.trigger} disabled={disabled} title={title} onClick={toggle}>
        <span className={selected ? styles.value : styles.placeholder}>{selected?.label ?? placeholder}</span>
        <svg className={styles.chevron} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className={styles.menu} style={menuStyle}>
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
