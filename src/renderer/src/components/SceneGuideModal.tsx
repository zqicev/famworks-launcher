import { useState } from 'react'
import styles from '../styles/SettingsModal.module.css'

interface Props {
  onClose: () => void
  /** Локальная сборка: применяем выбранную сцену (data-URL .glb/.gltf) как character.scene. */
  onApply?: (sceneUrl: string) => void
  /** Убрать свою сцену (вернуться к игроку + .animation.json). Показывается, если сцена задана. */
  onClear?: () => void
}

/** Гайд по единой сцене Blockbench (игрок + объекты + анимации в одном экспорте) + загрузка .glb/.gltf. */
export default function SceneGuideModal({ onClose, onApply, onClear }: Props): JSX.Element {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const pick = async (): Promise<void> => {
    if (!onApply) return
    setErr(''); setBusy(true)
    try {
      const r = await window.api.scene.pick()
      if (r.cancelled) return
      if (r.error || !r.dataUrl) { setErr('Не удалось прочитать файл'); return }
      onApply(r.dataUrl)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.modal} style={{ width: 580, maxWidth: '92vw' }} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Своя 3D-сцена</h2>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body} style={{ gap: 14, maxHeight: '68vh', overflowY: 'auto' }}>
          <p className={styles.hint} style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
            Вся сцена — игрок, любые объекты (питомец, декор) и их анимации — собирается в ОДНОМ проекте
            Blockbench и экспортируется одним файлом. Текстура игрока подменяется скином твоего аккаунта.
          </p>

          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
            <li><b style={{ color: 'var(--text)' }}>Blockbench → New → Generic Model</b> (glTF-совместимый формат).</li>
            <li>Собери рига игрока с костями <code>root, body, head, rightArm, leftArm, rightLeg, leftLeg</code>. UV игрока — как у обычного скина 64×64, чтобы скин лёг корректно. Лучше всего взять стандартный риг игрока Minecraft.</li>
            <li><b style={{ color: 'var(--text)' }}>Добавь 2-й слой</b> (шапка/куртка/рукава/штанины — внешние кубы поверх базовых с UV внешнего слоя). Без него у скина не будет верхнего слоя (волосы/куртка): в модели должна быть геометрия обоих слоёв.</li>
            <li>В этой же сцене добавь любые объекты рядом (своя иерархия костей, свои текстуры) — их материалы останутся собственными.</li>
            <li>Вкладка <b style={{ color: 'var(--text)' }}>Animate</b>: анимируй игрока и объекты. Все анимации проиграются одновременно и зациклятся.</li>
            <li><b style={{ color: 'var(--text)' }}>File → Export → Export glTF</b> (или GLB). GLB компактнее и всегда самодостаточный — рекомендуется.</li>
          </ol>

          <div className={styles.field} style={{ gap: 6 }}>
            <label className={styles.label}>ВАЖНО</label>
            <p className={styles.hint} style={{ margin: 0, lineHeight: 1.55 }}>
              Скин аккаунта заменяет текстуру только костей игрока (<code>root/body/head/…</code>) — назови их именно так.
              Файл должен быть самодостаточным (текстуры встроены): GLB или glTF Embedded. Анимации берутся прямо из файла — оси калибровать не нужно.
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
              {onClear && <button className={styles.cancelBtn} onClick={() => { onClear(); onClose() }}>Убрать сцену</button>}
              <button className={styles.saveBtn} onClick={pick} disabled={busy}>
                {busy ? 'Загрузка…' : 'Загрузить .glb / .gltf'}
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
