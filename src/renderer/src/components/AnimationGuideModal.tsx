import { useState } from 'react'
import { parseAnimationJson } from '../lib/animation'
import styles from '../styles/SettingsModal.module.css'

interface Props {
  onClose: () => void
  /** Если задан — сборка локальная, показываем загрузку файла и отдаём его содержимое. */
  onApply?: (idleData: string) => void
}

/** Гайд по созданию idle-анимации в Blockbench + (для локальных сборок) загрузка .animation.json. */
export default function AnimationGuideModal({ onClose, onApply }: Props): JSX.Element {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const pick = async (): Promise<void> => {
    if (!onApply) return
    setErr(''); setBusy(true)
    try {
      const r = await window.api.anim.pick()
      if (r.cancelled) return
      if (r.error || !r.text) { setErr('Не удалось прочитать файл'); return }
      if (!parseAnimationJson(r.text)) { setErr('Это не похоже на Bedrock .animation.json'); return }
      onApply(r.text)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.modal} style={{ width: 560, maxWidth: '92vw' }} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Своя анимация персонажа</h2>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body} style={{ gap: 14, maxHeight: '68vh', overflowY: 'auto' }}>
          <p className={styles.hint} style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
            Модель на «Обзоре» проигрывает idle-анимацию в формате Blockbench (Bedrock). Сделать свою:
          </p>

          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
            <li><b style={{ color: 'var(--text)' }}>Blockbench → File → New → Bedrock Model.</b> Это формат с вкладкой Animate и экспортом .animation.json.</li>
            <li>Собери риг игрока с костями <code>head, body, rightArm, leftArm, rightLeg, leftLeg</code> и стандартными пивотами. Можно взять готовый шаблон рига.</li>
            <li>Вкладка <b style={{ color: 'var(--text)' }}>Animate</b> → <b style={{ color: 'var(--text)' }}>New Animation</b>, назови <code>idle</code>, включи <b style={{ color: 'var(--text)' }}>Loop</b> и задай длину.</li>
            <li>Ставь ключевые кадры <b style={{ color: 'var(--text)' }}>Rotation</b> (и при желании Position). Для бесшовной петли кадры в начале и конце сделай одинаковыми.</li>
            <li><b style={{ color: 'var(--text)' }}>File → Export → Export Bedrock Animation</b> → получишь <code>idle.animation.json</code>.</li>
          </ol>

          <div className={styles.field} style={{ gap: 6 }}>
            <label className={styles.label}>ОГРАНИЧЕНИЯ</label>
            <p className={styles.hint} style={{ margin: 0, lineHeight: 1.55 }}>
              Работают числовые кадры поворотов и позиций. Molang-выражения и масштаб (scale) пока
              не поддерживаются. Кость <code>root</code> двигает всю модель.
            </p>
          </div>

          {onApply && err && (
            <p className={styles.hint} style={{ margin: 0, color: 'var(--red)' }}>{err}</p>
          )}
        </div>

        <div className={styles.footer}>
          {onApply ? (
            <>
              <button className={styles.cancelBtn} onClick={onClose}>Отмена</button>
              <button className={styles.saveBtn} onClick={pick} disabled={busy}>
                {busy ? 'Загрузка…' : 'Загрузить .animation.json'}
              </button>
            </>
          ) : (
            <button className={styles.saveBtn} onClick={onClose}>Понятно</button>
          )}
        </div>
      </div>
    </div>
  )
}
