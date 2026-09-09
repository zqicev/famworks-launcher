import { useEffect, useRef, useState } from 'react'
import * as skinview3d from 'skinview3d'
import steveUrl from '../assets/steve.png'
import { parseAnimationJson, createClipFn } from '../lib/animation'
import type { CharacterAnim } from '../../../types/modpack'
import styles from '../styles/CharacterStage.module.css'

interface Props {
  character?: CharacterAnim
}

/** Центральная 3D-сцена: анимированная модель скина игрока (skinview3d/Three.js) с idle-анимацией
 *  и мягким акцентным свечением у основания. Вращение отключено.
 *  Анимация idle берётся из сборки: character.idle_data (инлайн JSON) или character.idle (URL). */
export default function CharacterStage({ character }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    setReady(false)

    const w = wrap.clientWidth || 360
    const h = wrap.clientHeight || 460
    const viewer = new skinview3d.SkinViewer({ canvas, width: w, height: h, skin: steveUrl })
    viewer.fov = 40
    viewer.zoom = 0.82
    viewer.autoRotate = false
    viewer.controls.enableRotate = false // модель не вертим — только анимация
    viewer.controls.enableZoom = false
    viewer.controls.enablePan = false

    let disposed = false

    const applyClipText = (text: string | null | undefined): boolean => {
      if (!text) return false
      const clip = parseAnimationJson(text, character?.idle_name)
      if (!clip) return false
      const fn = createClipFn(clip) as unknown as ConstructorParameters<typeof skinview3d.FunctionAnimation>[0]
      viewer.animation = new skinview3d.FunctionAnimation(fn)
      return true
    }
    const setBuiltIn = (): void => { viewer.animation = new skinview3d.IdleAnimation() }

    // Анимацию задаём ТОЛЬКО когда она разрешена (инлайн/URL/встроенная) — чтобы не мелькала
    // смена «встроенный idle → клип сборки».
    let animPromise: Promise<unknown>
    if (character?.idle_data) {
      if (!applyClipText(character.idle_data)) setBuiltIn()
      animPromise = Promise.resolve()
    } else if (character?.idle) {
      animPromise = fetch(character.idle)
        .then(r => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then(text => { if (!disposed && !applyClipText(text)) setBuiltIn() })
        .catch(() => { if (!disposed) setBuiltIn() })
    } else {
      setBuiltIn()
      animPromise = Promise.resolve()
    }

    // Реальный скин активного аккаунта (если найдётся) — иначе остаётся дефолтный Steve.
    const skinPromise = window.api.skin.get()
      .then(res => { if (!disposed && res?.dataUrl) return viewer.loadSkin(res.dataUrl, { model: res.slim ? 'slim' : 'auto-detect' }) })
      .catch(() => {})

    // Показываем модель только когда и скин, и анимация готовы (никаких промежуточных поз).
    Promise.all([animPromise, skinPromise]).then(() => { if (!disposed) setReady(true) })

    const ro = new ResizeObserver(() => {
      const cw = wrap.clientWidth
      const ch = wrap.clientHeight
      if (cw > 0 && ch > 0) viewer.setSize(cw, ch)
    })
    ro.observe(wrap)

    // Не крутим анимацию, когда окно свёрнуто/не видно — бережём GPU.
    const onVis = (): void => { if (viewer.animation) viewer.animation.paused = document.hidden }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVis)
      ro.disconnect()
      viewer.dispose()
    }
  }, [character?.idle, character?.idle_data, character?.idle_name])

  return (
    <div ref={wrapRef} className={`${styles.stage} ${ready ? styles.ready : ''}`}>
      <div className={styles.glow} />
      <div className={styles.particles} aria-hidden="true">
        <i className={styles.p1} style={{ left: '12%' }} />
        <i className={styles.p2} style={{ left: '32%', animationDelay: '1.4s' }} />
        <i className={styles.p1} style={{ left: '58%', animationDelay: '3s' }} />
        <i className={styles.p2} style={{ left: '78%', animationDelay: '2.2s' }} />
        <i className={styles.p1} style={{ left: '90%', animationDelay: '4.1s' }} />
      </div>
      <canvas ref={canvasRef} className={styles.canvas} />
      {!ready && <div className={styles.loader} aria-label="Загрузка"><span className={styles.spin} /></div>}
    </div>
  )
}
