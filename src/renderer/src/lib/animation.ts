// Плеер анимаций формата Minecraft Bedrock (.animation.json из Blockbench) для рига skinview3d.
// Поддержка: rotation и position (линейная интерполяция), кость root -> вся модель.
// Не поддерживается: scale и molang-выражения (числовые кадры покрывают ручные анимации).

type Vec3 = [number, number, number]
type Keyframe = [number, Vec3] // [времяСек, [x,y,z]]

interface BoneTrack { rotation: Keyframe[] | null; position: Keyframe[] | null }
export interface AnimClip {
  loop: boolean
  length: number
  bones: Record<string, BoneTrack>
}

// Кости рига skinview3d (player.skin.*). Особая кость root двигает всю модель.
const PART_NAMES = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'] as const
const RAD = Math.PI / 180

// Маппинг осей Bedrock -> skinview3d (three). У skinview3d ось X зеркальна относительно
// Bedrock (rightArm стоит на x=-5, а в Bedrock-риге на x=+5), т.е. модель отражена по X.
// Отражение по X даёт: поворот [+x,-y,-z], позиция [-x,+y,+z], БЕЗ обмена left/right
// (отражение само ставит конечности на верную сторону) и порядок Эйлера ZYX (как в Blockbench;
// у руки поворот сразу по 3 осям, при XYZ твист уводил её в сторону вместо к голове).
// ЕДИНАЯ точка калибровки: если поза всё же зеркалит по одной оси — меняем знак здесь.
const ROT_SIGN: Vec3 = [1, -1, -1] // поворот КОНЕЧНОСТЕЙ x,y,z (зеркалит Y,Z)
const POS_SIGN: Vec3 = [-1, 1, 1]  // позиция x,y,z (в тех же единицах, что риг ~ пиксели)
const EULER_ORDER = 'ZYX'          // порядок применения поворотов (Bedrock/Blockbench)
// root двигает ВСЮ модель. Сама модель не отражена (лицо на +Z), отражены лишь позиции
// конечностей — поэтому у root зеркало НЕ применяем (иначе разворот уходит не в ту сторону).
const ROOT_ROT_SIGN: Vec3 = [1, 1, 1]

function num(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const n = parseFloat(v); return isNaN(n) ? 0 : n } // molang не считаем
  return 0
}

function toVec3(raw: unknown): Vec3 {
  if (Array.isArray(raw)) return [num(raw[0]), num(raw[1]), num(raw[2])]
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    const arr = (o.post ?? o.pre) as unknown
    if (Array.isArray(arr)) return [num(arr[0]), num(arr[1]), num(arr[2])]
  }
  return [0, 0, 0]
}

/** Канал (rotation/position) -> отсортированные кадры. Массив = константа (кадр в t=0). */
function parseChannel(ch: unknown): Keyframe[] | null {
  if (!ch) return null
  if (Array.isArray(ch)) return [[0, toVec3(ch)]]
  if (typeof ch === 'object') {
    const frames: Keyframe[] = Object.entries(ch as Record<string, unknown>)
      .map(([time, v]) => [parseFloat(time), toVec3(v)] as Keyframe)
      .filter(f => !isNaN(f[0]))
      .sort((a, b) => a[0] - b[0])
    return frames.length ? frames : null
  }
  return null
}

/** Разбирает .animation.json. Берёт анимацию по имени, иначе первую. null, если пусто. */
export function parseAnimationJson(text: string, wantName?: string): AnimClip | null {
  let root: unknown
  try { root = JSON.parse(text) } catch { return null }
  const animations = (root as { animations?: Record<string, unknown> })?.animations
  if (!animations || typeof animations !== 'object') return null

  const names = Object.keys(animations)
  if (!names.length) return null
  const name = (wantName && animations[wantName]) ? wantName : names[0]
  const anim = animations[name] as Record<string, unknown>

  const bonesRaw = (anim.bones ?? {}) as Record<string, Record<string, unknown>>
  const bones: Record<string, BoneTrack> = {}
  let maxT = 0
  for (const [bone, channels] of Object.entries(bonesRaw)) {
    const rotation = parseChannel(channels?.rotation)
    const position = parseChannel(channels?.position)
    for (const kf of [rotation, position]) if (kf) for (const [t] of kf) if (t > maxT) maxT = t
    bones[camel(bone)] = { rotation, position }
  }

  const length = num(anim.animation_length) || maxT || 1
  const loop = anim.loop === true
  return { loop, length, bones }
}

/** right_arm -> rightArm; root/head/... как есть. */
function camel(b: string): string {
  return b.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

function sample(kf: Keyframe[], t: number): Vec3 {
  const n = kf.length
  if (t <= kf[0][0]) return kf[0][1]
  if (t >= kf[n - 1][0]) return kf[n - 1][1]
  for (let i = 0; i < n - 1; i++) {
    const [t0, v0] = kf[i]
    const [t1, v1] = kf[i + 1]
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / ((t1 - t0) || 1)
      return [v0[0] + (v1[0] - v0[0]) * f, v0[1] + (v1[1] - v0[1]) * f, v0[2] + (v1[2] - v0[2]) * f]
    }
  }
  return kf[n - 1][1]
}

interface Vector3Like { x: number; y: number; z: number; set(x: number, y: number, z: number): void }
interface EulerLike { order: string; set(x: number, y: number, z: number): void }
interface Part { rotation: EulerLike; position: Vector3Like }
interface RigPlayer { rotation: EulerLike; position: Vector3Like; skin: Record<string, Part> }

/** Функция для skinview3d.FunctionAnimation: сбрасывает позу в покой и применяет кадры клипа.
 *  position-кадры — это СМЕЩЕНИЕ от базовой позиции кости, поэтому базовые позиции запоминаем
 *  (иначе руки/ноги «улетят» в центр). Кость root двигает всю модель. */
export function createClipFn(clip: AnimClip): (player: RigPlayer, progress: number) => void {
  let rest: Record<string, Vec3> | null = null
  let prest: Vec3 = [0, 0, 0]

  return (player, progress) => {
    if (!rest) {
      rest = {}
      for (const p of PART_NAMES) {
        const q = player.skin[p]?.position
        if (q) rest[p] = [q.x, q.y, q.z]
      }
      prest = [player.position.x, player.position.y, player.position.z]
    }

    const t = clip.loop ? (progress % clip.length) : Math.min(progress, clip.length)

    // поза покоя (+ порядок Эйлера как в Bedrock)
    player.rotation.order = EULER_ORDER
    player.rotation.set(0, 0, 0)
    player.position.set(prest[0], prest[1], prest[2])
    for (const p of PART_NAMES) {
      const part = player.skin[p]
      if (!part) continue
      part.rotation.order = EULER_ORDER
      part.rotation.set(0, 0, 0)
      const r = rest[p]
      if (r) part.position.set(r[0], r[1], r[2])
    }

    for (const [bone, track] of Object.entries(clip.bones)) {
      if (bone === 'root') {
        if (track.rotation) { const [x, y, z] = sample(track.rotation, t); player.rotation.set(ROOT_ROT_SIGN[0] * x * RAD, ROOT_ROT_SIGN[1] * y * RAD, ROOT_ROT_SIGN[2] * z * RAD) }
        if (track.position) { const [x, y, z] = sample(track.position, t); player.position.set(prest[0] + POS_SIGN[0] * x, prest[1] + POS_SIGN[1] * y, prest[2] + POS_SIGN[2] * z) }
        continue
      }
      const part = player.skin[bone]
      if (!part) continue
      if (track.rotation) { const [x, y, z] = sample(track.rotation, t); part.rotation.set(ROT_SIGN[0] * x * RAD, ROT_SIGN[1] * y * RAD, ROT_SIGN[2] * z * RAD) }
      if (track.position) { const [x, y, z] = sample(track.position, t); const r = rest[bone] ?? [0, 0, 0]; part.position.set(r[0] + POS_SIGN[0] * x, r[1] + POS_SIGN[1] * y, r[2] + POS_SIGN[2] * z) }
    }
  }
}
