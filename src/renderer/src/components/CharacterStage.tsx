import { useEffect, useRef } from 'react'
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
 *  Idle можно переопределить на сборку через character.idle (Blockbench .animation.json по URL). */
export default function CharacterStage({ character }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const w = wrap.clientWidth || 360
    const h = wrap.clientHeight || 460
    const viewer = new skinview3d.SkinViewer({ canvas, width: w, height: h, skin: steveUrl })
    viewer.animation = new skinview3d.IdleAnimation() // дефолт, пока не пришёл клип сборки
    viewer.fov = 40
    viewer.zoom = 0.82
    viewer.autoRotate = false
    viewer.controls.enableRotate = false // модель не вертим — только анимация
    viewer.controls.enableZoom = false
    viewer.controls.enablePan = false

    let disposed = false

    // Реальный скин активного аккаунта (если найдётся) — иначе остаётся дефолтный Steve.
    window.api.skin.get()
      .then(res => {
        if (!disposed && res?.dataUrl) {
          viewer.loadSkin(res.dataUrl, { model: res.slim ? 'slim' : 'auto-detect' }).catch(() => {})
        }
      })
      .catch(() => {})

    // Idle-анимация по сборке (Blockbench .animation.json). При ошибке остаётся встроенный idle.
    if (character?.idle) {
      fetch(character.idle)
        .then(r => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then(text => {
          if (disposed) return
          const clip = parseAnimationJson(text, character.idle_name)
          if (clip) {
            const fn = createClipFn(clip) as unknown as ConstructorParameters<typeof skinview3d.FunctionAnimation>[0]
            viewer.animation = new skinview3d.FunctionAnimation(fn)
          }
        })
        .catch(() => { /* нет клипа/сети — остаётся встроенный idle */ })
    }

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
  }, [character?.idle, character?.idle_name])

  return (
    <div ref={wrapRef} className={styles.stage}>
      <div className={styles.glow} />
      <div className={styles.particles} aria-hidden="true">
        <i className={styles.p1} style={{ left: '12%' }} />
        <i className={styles.p2} style={{ left: '32%', animationDelay: '1.4s' }} />
        <i className={styles.p1} style={{ left: '58%', animationDelay: '3s' }} />
        <i className={styles.p2} style={{ left: '78%', animationDelay: '2.2s' }} />
        <i className={styles.p1} style={{ left: '90%', animationDelay: '4.1s' }} />
      </div>
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  )
}
