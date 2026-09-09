import { useEffect, useRef } from 'react'
import * as skinview3d from 'skinview3d'
import steveUrl from '../assets/steve.png'
import styles from '../styles/CharacterStage.module.css'

/** Центральная 3D-сцена: анимированная модель скина игрока (skinview3d/Three.js) с idle-анимацией
 *  и мягким акцентным свечением у основания. Вращение отключено.
 *  Дальше сюда навесим анимации по сборке и Blockbench-клипы. */
export default function CharacterStage(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const w = wrap.clientWidth || 360
    const h = wrap.clientHeight || 460
    const viewer = new skinview3d.SkinViewer({ canvas, width: w, height: h, skin: steveUrl })
    viewer.animation = new skinview3d.IdleAnimation()
    viewer.fov = 40
    viewer.zoom = 0.82
    viewer.autoRotate = false
    viewer.controls.enableRotate = false // модель не вертим — только idle
    viewer.controls.enableZoom = false
    viewer.controls.enablePan = false

    // Реальный скин активного аккаунта (если найдётся) — иначе остаётся дефолтный Steve.
    let disposed = false
    window.api.skin.get()
      .then(res => {
        if (!disposed && res?.dataUrl) {
          viewer.loadSkin(res.dataUrl, { model: res.slim ? 'slim' : 'auto-detect' }).catch(() => {})
        }
      })
      .catch(() => {})

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
  }, [])

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
