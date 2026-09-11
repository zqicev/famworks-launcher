import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as skinview3d from 'skinview3d'
import steveUrl from '../assets/steve.png'
import { Particles, Spinner } from './StageDecor'
import { parseAnimationJson, createClipFn } from '../lib/animation'
import type { CharacterAnim } from '../../../types/modpack'
import styles from '../styles/CharacterStage.module.css'

interface Props {
  character?: CharacterAnim
}

type PlayerObj = skinview3d.PlayerObject
type PoseFn = (player: PlayerObj, progress: number) => void

/** Освобождает GPU-ресурсы дерева объектов (геометрии/материалы/текстуры). */
function disposeObject(root: THREE.Object3D): void {
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = (mesh as THREE.Mesh).material
    const mats = Array.isArray(mat) ? mat : mat ? [mat] : []
    for (const m of mats) {
      for (const k of Object.keys(m)) {
        const v = (m as unknown as Record<string, unknown>)[k]
        if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose()
      }
      m.dispose()
    }
  })
}

/** Центральная 3D-сцена: анимированная модель скина игрока (skinview3d/Three.js) с idle-анимацией,
 *  мягким акцентным свечением и доп. glTF-объектами (пчела/питомец/декор) со своими анимациями.
 *  Всё анимируется в ОДНОМ кадре skinview3d (общий delta) — без рассинхрона и второго render-цикла. */
export default function CharacterStage({ character }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const objectsKey = JSON.stringify(character?.objects ?? [])

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
    viewer.controls.enableRotate = false
    viewer.controls.enableZoom = false
    viewer.controls.enablePan = false

    let disposed = false
    const mixers: THREE.AnimationMixer[] = []
    const loaded: THREE.Object3D[] = []
    let clipFn: PoseFn | null = null // idle-поза игрока по сборке (иначе встроенный idle)
    const idle = new skinview3d.IdleAnimation()

    // Единый аниматор: поза игрока + тик всех миксеров ОДНИМ delta кадра skinview3d.
    viewer.animation = new skinview3d.FunctionAnimation((player, progress, delta) => {
      if (clipFn) clipFn(player, progress)
      else idle.update(player, delta)
      for (const m of mixers) m.update(delta)
    })

    const applyClipText = (text: string | null | undefined): boolean => {
      if (!text) return false
      const clip = parseAnimationJson(text, character?.idle_name)
      if (!clip) return false
      clipFn = createClipFn(clip) as unknown as PoseFn
      return true
    }

    // Анимация игрока: инлайн JSON / URL / встроенная.
    let animPromise: Promise<unknown>
    if (character?.idle_data) {
      applyClipText(character.idle_data)
      animPromise = Promise.resolve()
    } else if (character?.idle) {
      animPromise = fetch(character.idle)
        .then(r => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then(text => { if (!disposed) applyClipText(text) })
        .catch(() => { /* нет клипа — остаётся встроенный idle */ })
    } else {
      animPromise = Promise.resolve()
    }

    // Реальный скин активного аккаунта (иначе дефолтный Steve).
    const skinPromise = window.api.skin.get()
      .then(res => { if (!disposed && res?.dataUrl) return viewer.loadSkin(res.dataUrl, { model: res.slim ? 'slim' : 'auto-detect' }) })
      .catch(() => {})

    // Активный аккаунт сменился (событие из панели) - перезагружаем скин на лету.
    const reloadSkin = (): void => {
      window.api.skin.get()
        .then(res => { if (!disposed && res?.dataUrl) return viewer.loadSkin(res.dataUrl, { model: res.slim ? 'slim' : 'auto-detect' }) })
        .catch(() => {})
    }
    window.addEventListener('fw:account-changed', reloadSkin)

    // Доп. glTF-объекты сцены со своими анимациями (позиция/движение целиком из файла).
    const gltfLoader = new GLTFLoader()
    const objectsPromise = Promise.all(
      (character?.objects ?? []).map(obj =>
        gltfLoader.loadAsync(obj.url).then(gltf => {
          if (disposed) { disposeObject(gltf.scene); return }
          if (obj.scale && obj.scale !== 1) gltf.scene.scale.setScalar(obj.scale)
          viewer.scene.add(gltf.scene)
          loaded.push(gltf.scene)
          if (gltf.animations.length) {
            const mixer = new THREE.AnimationMixer(gltf.scene)
            for (const clip of gltf.animations) mixer.clipAction(clip).play()
            mixers.push(mixer)
          }
        }).catch(() => { /* битый/недоступный объект — пропускаем */ })
      )
    )

    Promise.all([animPromise, skinPromise, objectsPromise]).then(() => { if (!disposed) setReady(true) })

    const ro = new ResizeObserver(() => {
      const cw = wrap.clientWidth
      const ch = wrap.clientHeight
      if (cw > 0 && ch > 0) viewer.setSize(cw, ch)
    })
    ro.observe(wrap)

    // Пауза когда окно не видно (FunctionAnimation.paused тормозит и позу игрока, и миксеры вместе).
    const onVis = (): void => { if (viewer.animation) viewer.animation.paused = document.hidden }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      disposed = true
      window.removeEventListener('fw:account-changed', reloadSkin)
      document.removeEventListener('visibilitychange', onVis)
      ro.disconnect()
      for (const m of mixers) m.stopAllAction()
      for (const o of loaded) { viewer.scene.remove(o); disposeObject(o) }
      viewer.dispose()
    }
  }, [character?.idle, character?.idle_data, character?.idle_name, objectsKey])

  return (
    <div ref={wrapRef} className={`${styles.stage} ${ready ? styles.ready : ''}`}>
      <div className={styles.glow} />
      <Particles />
      <canvas ref={canvasRef} className={styles.canvas} />
      {!ready && <div className={styles.loader} aria-label="Загрузка"><Spinner /></div>}
    </div>
  )
}
