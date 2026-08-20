import { useState } from 'react'
import { formatBytes } from '../lib/format'
import { ACCENT_PRESETS, DEFAULT_ACCENT, applyAccent, normalizeHex } from '../lib/theme'
import styles from '../styles/SettingsModal.module.css'

interface Props {
  installPath: string
  onPathChange: (path: string) => void
  devMode: boolean
  onDevModeChange: (v: boolean) => void
  onClose: () => void
}

export default function SettingsModal({ installPath, onPathChange, devMode, onDevModeChange, onClose }: Props) {
  const [path, setPath] = useState(installPath)
  const [cleaning, setCleaning] = useState(false)
  const [cleanMsg, setCleanMsg] = useState('')
  const [accent, setAccent] = useState(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent')
    return normalizeHex(v) ?? DEFAULT_ACCENT
  })

  // Акцент применяем и сохраняем сразу — как переключатель dev-режима (без «Сохранить»).
  const pickAccent = (hex: string) => {
    const norm = normalizeHex(hex)
    if (!norm) return
    setAccent(norm)
    applyAccent(norm)
    window.api.store.set('accentColor', norm)
  }

  const cleanup = async () => {
    setCleaning(true); setCleanMsg('')
    try {
      const r = await window.api.cleanupJunk()
      setCleanMsg(r.freedBytes > 0
        ? `Освобождено ${formatBytes(r.freedBytes)} (сборок: ${r.instances})`
        : 'Мусора не найдено — всё чисто')
    } catch {
      setCleanMsg('Не удалось очистить')
    } finally {
      setCleaning(false)
    }
  }

  const toggleDev = () => {
    const v = !devMode
    window.api.store.set('devMode', v)
    onDevModeChange(v)
  }

  const pickFolder = async () => {
    const p = await window.api.dialog.pickFolder()
    if (p) setPath(p)
  }

  const save = async () => {
    await window.api.store.set('installPath', path)
    onPathChange(path)
    onClose()
  }

  return (
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Настройки</h2>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          <div className={styles.field}>
            <label className={styles.label}>ПАПКА УСТАНОВКИ</label>
            <div className={styles.pathRow}>
              <div className={styles.pathDisplay}>
                {path || <span className={styles.placeholder}>Не выбрана</span>}
              </div>
              <button className={styles.browseBtn} onClick={pickFolder}>Обзор</button>
              {path && (
                <button className={styles.iconBtn} onClick={() => window.api.shell.openFolder(path)} title="Открыть в проводнике">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 5h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
                  </svg>
                </button>
              )}
            </div>
            <p className={styles.hint}>
              Сборки устанавливаются в отдельные подпапки внутри этой директории.
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>ВНЕШНИЙ ВИД</label>
            <div className={styles.swatchRow}>
              {ACCENT_PRESETS.map(p => (
                <button
                  key={p.hex}
                  className={`${styles.swatch} ${accent === p.hex ? styles.swatchOn : ''}`}
                  style={{ background: p.hex }}
                  onClick={() => pickAccent(p.hex)}
                  title={p.name}
                />
              ))}
              <label className={styles.swatchCustom} title="Свой цвет" style={{ background: accent }}>
                <input type="color" value={accent} onChange={e => pickAccent(e.target.value)} />
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" />
                </svg>
              </label>
            </div>
            <p className={styles.hint}>
              Акцентный цвет интерфейса. Выбери пресет или свой цвет.
              {accent !== DEFAULT_ACCENT && (
                <> · <button className={styles.linkBtn} onClick={() => pickAccent(DEFAULT_ACCENT)}>сбросить</button></>
              )}
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>ОЧИСТКА МЕСТА</label>
            <div className={styles.pathRow}>
              <button className={styles.browseBtn} onClick={cleanup} disabled={cleaning}>
                {cleaning ? 'Очистка…' : 'Очистить мусор сборок'}
              </button>
              {cleanMsg && <span className={styles.hint} style={{ margin: 0, alignSelf: 'center' }}>{cleanMsg}</span>}
            </div>
            <p className={styles.hint}>
              Удаляет из сборок лишнее: старые копии игровых ассетов (теперь общие) и установщики загрузчиков. Моды, миры и настройки не затрагиваются.
            </p>
          </div>

          <div className={styles.field}>
            <button className={styles.toggleRow} onClick={toggleDev}>
              <div>
                <div className={styles.label} style={{ marginBottom: 4 }}>РЕЖИМ РАЗРАБОТЧИКА</div>
                <p className={styles.hint} style={{ margin: 0 }}>Вкладка «Разработка»: запуск с отладкой (JDWP) и интеграция с IntelliJ IDEA.</p>
              </div>
              <span className={`${styles.switch} ${devMode ? styles.switchOn : ''}`}><span className={styles.knob} /></span>
            </button>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Отмена</button>
          <button className={styles.saveBtn} onClick={save} disabled={!path}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}
