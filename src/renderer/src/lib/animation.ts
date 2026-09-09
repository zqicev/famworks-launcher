// Плеер анимаций формата Minecraft Bedrock (.animation.json из Blockbench) для рига skinview3d.
// v1: только повороты костей (rotation) с линейной интерполяцией по ключевым кадрам.
// Позиция/скейл и molang-выражения пока не поддерживаются (числовые кадры покрывают 95% ручных анимаций).

type Vec3 = [number, number, number]
type Keyframe = [number, Vec3] // [времяСек, [x,y,z] градусы]

interface BoneTrack { rotation: Keyframe[] | null }
export interface AnimClip {
  loop: boolean
  length: number
  bones: Record<string, BoneTrack>
}

// Кости рига skinview3d (player.skin.*). Имена из Blockbench приводим к ним.
const PART_NAMES = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'] as const
const RAD = Math.PI / 180

function num(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const n = parseFloat(v); return isNaN(n) ? 0 : n } // molang не считаем — берём 0
  return 0
}

/** Приводит значение канала (rotation) к [x,y,z]. Поддерживает массив и форму {pre,post}. */
function toVec3(raw: unknown): Vec3 {
  if (Array.isArray(raw)) return [num(raw[0]), num(raw[1]), num(raw[2])]
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    const arr = (o.post ?? o.pre) as unknown
    if (Array.isArray(arr)) return [num(arr[0]), num(arr[1]), num(arr[2])]
  }
  return [0, 0, 0]
}

/** rotation-канал → отсортированные ключевые кадры. Массив = константа (кадр в t=0). */
function parseRotation(rot: unknown): Keyframe[] | null {
  if (!rot) return null
  if (Array.isArray(rot)) return [[0, toVec3(rot)]]
  if (typeof rot === 'object') {
    const frames: Keyframe[] = Object.entries(rot as Record<string, unknown>)
      .map(([time, v]) => [parseFloat(time), toVec3(v)] as Keyframe)
      .filter(f => !isNaN(f[0]))
      .sort((a, b) => a[0] - b[0])
    return frames.length ? frames : null
  }
  return null
}

/** Разбирает .animation.json. Берёт анимацию по имени, иначе первую. Возвращает null, если пусто. */
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
    const rotation = parseRotation(channels?.rotation)
    if (rotation) { for (const [t] of rotation) if (t > maxT) maxT = t }
    bones[camel(bone)] = { rotation }
  }

  const length = num(anim.animation_length) || maxT || 1
  const loop = anim.loop === true
  return { loop, length, bones }
}

/** right_arm → rightArm; остальное как есть. */
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

/** Тип кости рига skinview3d (у каждой есть .rotation). */
interface Part { rotation: { set(x: number, y: number, z: number): void } }
interface RigPlayer { skin: Record<string, Part> }

/** Функция для skinview3d.FunctionAnimation: сбрасывает позу и применяет кадры клипа.
 *  Маппинг осей Bedrock→three: (-x, -y, z). Единая точка калибровки под реальный Blockbench-экспорт. */
export function createClipFn(clip: AnimClip): (player: RigPlayer, progress: number) => void {
  return (player, progress) => {
    const t = clip.loop ? (progress % clip.length) : Math.min(progress, clip.length)
    for (const p of PART_NAMES) player.skin[p]?.rotation.set(0, 0, 0) // поза покоя
    for (const [bone, track] of Object.entries(clip.bones)) {
      const part = player.skin[bone]
      if (!part || !track.rotation) continue
      const [x, y, z] = sample(track.rotation, t)
      part.rotation.set(-x * RAD, -y * RAD, z * RAD)
    }
  }
}
