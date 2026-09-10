import { useState } from 'react'
import exampleUrl from '../assets/famlauncher_example.bbmodel?url'
import styles from '../styles/SettingsModal.module.css'

interface Props {
  onClose: () => void
  /** Локальная сборка: применяем выбранную сцену (data-URL .glb/.gltf) как character.scene. */
  onApply?: (sceneUrl: string) => void
  /** Убрать свою сцену (вернуться к дефолтному персонажу). Показывается, если сцена задана. */
  onClear?: () => void
}

/** Гайд + загрузка своей 3D-сцены (.gltf): модель игрока + объекты + анимации init/idle одним файлом. */
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

  // Отдаём пользователю пример проекта Blockbench, чтобы делать свои анимации на его основе.
  const downloadExample = async (): Promise<void> => {
    setErr('')
    try {
      const text = await fetch(exampleUrl).then(r => r.text())
      const r = await window.api.scene.saveExample(text)
      if (r.error) setErr('Не удалось сохранить пример')
    } catch {
      setErr('Не удалось сохранить пример')
    }
  }

  return (
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.modal} style={{ width: 580, maxWidth: '92vw' }} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Своя анимация персонажа</h2>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body} style={{ gap: 14, maxHeight: '68vh', overflowY: 'auto' }}>
          <p className={styles.hint} style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
            Персонаж и всё вокруг — это один проект Blockbench (модель игрока + объекты + анимации),
            экспортированный в <b style={{ color: 'var(--text)' }}>.gltf</b>. Скин игрока подменяется скином
            твоего аккаунта автоматически. Проще всего взять готовый пример и переделать под себя.
          </p>

          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
            <li><b style={{ color: 'var(--text)' }}>Скачай пример</b> (кнопка ниже) и открой его в Blockbench — там уже собран риг игрока с обоими слоями скина, пример объекта (пчела) и две анимации.</li>
            <li>Вкладка <b style={{ color: 'var(--text)' }}>Animate</b>. В проекте две анимации:
              <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                <li><code>init</code> — играет <b style={{ color: 'var(--text)' }}>один раз</b> при загрузке (появление/вступление). Можно оставить пустой.</li>
                <li><code>idle</code> — включается <b style={{ color: 'var(--text)' }}>после init</b> и <b style={{ color: 'var(--text)' }}>зациклена</b> (спокойное состояние).</li>
              </ul>
            </li>
            <li>Меняй анимации и добавляй свои объекты прямо в этот же проект (своя иерархия костей и текстуры — они останутся своими).</li>
            <li><b style={{ color: 'var(--text)' }}>File → Export → Export glTF</b> — получишь один <code>.gltf</code> со всем содержимым.</li>
            <li>Нажми <b style={{ color: 'var(--text)' }}>«Загрузить .gltf»</b> здесь — лаунчер вытянет из файла и модель, и обе анимации.</li>
          </ol>

          <div className={styles.field} style={{ gap: 6 }}>
            <label className={styles.label}>ВАЖНО</label>
            <p className={styles.hint} style={{ margin: 0, lineHeight: 1.55 }}>
              Не переименовывай кости игрока (<code>root/body/head/rightArm/leftArm/rightLeg/leftLeg</code>) — по ним
              накладывается скин. Оставь имена анимаций <code>init</code> и <code>idle</code>. При экспорте выбирай
              glTF Embedded (текстуры внутри файла), чтобы всё работало одним файлом.
            </p>
          </div>

          {err && <p className={styles.hint} style={{ margin: 0, color: 'var(--red)' }}>{err}</p>}
        </div>

        <div className={styles.footer}>
          {onApply ? (
            <>
              <button className={styles.cancelBtn} onClick={onClose}>Отмена</button>
              {onClear && <button className={styles.cancelBtn} onClick={() => { onClear(); onClose() }}>Убрать</button>}
              <button className={styles.cancelBtn} onClick={downloadExample}>Скачать пример</button>
              <button className={styles.saveBtn} onClick={pick} disabled={busy}>
                {busy ? 'Загрузка…' : 'Загрузить .gltf'}
              </button>
            </>
          ) : (
            <>
              <button className={styles.cancelBtn} onClick={downloadExample}>Скачать пример</button>
              <button className={styles.saveBtn} onClick={onClose}>Понятно</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
