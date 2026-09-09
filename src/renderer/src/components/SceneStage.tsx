import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import steveUrl from '../assets/steve.png'
import styles from '../styles/CharacterStage.module.css'

interface Props {
  scene: string // URL или data: к .glb/.gltf (игрок + объекты + анимации из одного проекта Blockbench)
}

// Кости стандартного рига игрока — их меши получают скин аккаунта; остальное (объекты) — свои текстуры.
const PLAYER_BONES = new Set([
  'root', 'waist', 'body', 'head', 'helmet',
  'rightArm', 'leftArm', 'rightLeg', 'leftLeg', 'rightItem', 'leftItem'
])

function isPlayerMesh(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    if (PLAYER_BONES.has(p.name)) return true
  }
  return false
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material
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

/** Единая 3D-сцена из одного экспорта Blockbench (.glb): игрок + объекты + все анимации.
 *  Текстура игрока подменяется скином аккаунта. Свой рендер-цикл (один clock — без рассинхрона). */
export default function SceneStage({ scene: sceneUrl }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    setReady(false)

    let w = wrap.clientWidth || 360
    let h = wrap.clientHeight || 460
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h, false)
    renderer.setClearColor(0x000000, 0)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, w / h, 0.01, 1000)
    scene.add(new THREE.AmbientLight(0xffffff, 1.25))
    const dir = new THREE.DirectionalLight(0xffffff, 0.45)
    dir.position.set(0.5, 1, 1.5)
    scene.add(dir)

    let disposed = false
    let mixer: THREE.AnimationMixer | null = null
    let rootObj: THREE.Object3D | null = null
    const clock = new THREE.Clock()
    let raf = 0

    const frameCamera = (): void => {
      const target = rootObj ?? scene
      const box = new THREE.Box3().setFromObject(target)
      if (!isFinite(box.min.y)) return
      const c = box.getCenter(new THREE.Vector3())
      const s = box.getSize(new THREE.Vector3())
      const height = s.y || 1
      const dist = (height / (2 * Math.tan((40 * Math.PI) / 180 / 2))) * 1.6
      camera.position.set(c.x, c.y, c.z + dist)
      camera.lookAt(c.x, c.y, c.z)
      camera.updateProjectionMatrix()
    }

    // Скин аккаунта (иначе дефолтный Steve) как текстура для материала игрока.
    const loadSkinTexture = async (): Promise<THREE.Texture> => {
      let url = steveUrl
      try { const res = await window.api.skin.get(); if (res?.dataUrl) url = res.dataUrl } catch { /* дефолт */ }
      const tex = await new THREE.TextureLoader().loadAsync(url)
      tex.flipY = false
      tex.colorSpace = THREE.SRGBColorSpace
      tex.magFilter = THREE.NearestFilter
      tex.minFilter = THREE.NearestFilter
      tex.generateMipmaps = false
      tex.needsUpdate = true
      return tex
    }

    const gltfLoader = new GLTFLoader()
    Promise.all([gltfLoader.loadAsync(sceneUrl), loadSkinTexture()])
      .then(([gltf, skinTex]) => {
        if (disposed) { disposeTree(gltf.scene); skinTex.dispose(); return }
        scene.add(gltf.scene)
        rootObj = gltf.scene.getObjectByName('root') ?? gltf.scene

        // Подменяем карту у материалов игрока (они общие для всех его частей).
        const done = new Set<THREE.Material>()
        gltf.scene.traverse(o => {
          const mesh = o as THREE.Mesh
          if (!mesh.isMesh || !isPlayerMesh(mesh)) return
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const m of mats) {
            if (done.has(m)) continue
            const std = m as THREE.MeshStandardMaterial
            std.map = skinTex
            std.needsUpdate = true
            done.add(m)
          }
        })

        frameCamera()
        if (gltf.animations.length) {
          mixer = new THREE.AnimationMixer(gltf.scene)
          for (const clip of gltf.animations) mixer.clipAction(clip).play()
        }
        setReady(true)
      })
      .catch(() => { if (!disposed) setReady(true) }) // не смогли — снимаем спиннер, покажем пустую сцену

    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      if (document.hidden) { clock.getDelta(); return } // не копим delta пока скрыто
      const dt = clock.getDelta()
      if (mixer) mixer.update(dt)
      renderer.render(scene, camera)
    }
    tick()

    const ro = new ResizeObserver(() => {
      const cw = wrap.clientWidth
      const ch = wrap.clientHeight
      if (cw > 0 && ch > 0 && (cw !== w || ch !== h)) {
        w = cw; h = ch
        renderer.setSize(w, h, false)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      }
    })
    ro.observe(wrap)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      if (mixer) mixer.stopAllAction()
      disposeTree(scene)
      renderer.dispose()
    }
  }, [sceneUrl])

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
