import axios from 'axios'
import os from 'os'
import { app } from 'electron'
import { randomUUID } from 'crypto'
import { store } from './store'
import { getPortalToken } from './portal'

// Аналитика лаунчера: ненавязчивая отправка событий на портал (см. docs/analytics.md).
// Не блокирует запуск/игру, ошибок пользователю не показывает. Выключается в настройках.

const ENDPOINT = 'https://portal.famworks.ru/api/analytics/events'
const QUEUE_MAX = 500
const BATCH = 100

interface AEvent {
  type: string
  at: string
  installId: string
  user?: { uuid?: string; name?: string }
  ref?: string
  data?: Record<string, unknown>
}
type User = { uuid?: string; name?: string }

/** Сбор статистики включён (по умолчанию да). */
export function analyticsEnabled(): boolean {
  const v = store.get('analyticsEnabled')
  return v === undefined ? true : !!v
}

/** Переключатель из настроек. Выключили — чистим накопленную очередь. */
export function setAnalyticsEnabled(enabled: boolean): void {
  store.set('analyticsEnabled', enabled)
  if (!enabled) store.set('analyticsQueue', [])
}

/** Случайный id установки (создаётся один раз, не связан с железом). */
export function getInstallId(): string {
  let id = store.get('analyticsInstallId') as string | undefined
  if (!id) { id = randomUUID(); store.set('analyticsInstallId', id) }
  return id
}

function readQueue(): AEvent[] {
  const q = store.get('analyticsQueue') as AEvent[] | undefined
  return Array.isArray(q) ? q : []
}
function writeQueue(q: AEvent[]): void { store.set('analyticsQueue', q) }

/** Активный аккаунт Minecraft для события (если есть). */
function activeUser(): User | undefined {
  try {
    const accounts = (store.get('accounts') as { id: string; username?: string; uuid?: string }[] | undefined) ?? []
    const activeId = store.get('activeAccountId') as string | null
    const acc = accounts.find(a => a.id === activeId) ?? accounts[0]
    if (!acc) return undefined
    const u: User = {}
    if (acc.uuid) u.uuid = acc.uuid
    if (acc.username) u.name = acc.username
    return (u.uuid || u.name) ? u : undefined
  } catch { return undefined }
}

/** Minecraft-uuid в формате с дефисами (портал требует 8-4-4-4-12). Невалидный → undefined. */
function dashUuid(uuid: string | undefined): string | undefined {
  if (!uuid) return undefined
  const hex = uuid.replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) return undefined
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Нормализует user для события: uuid приводим к формату с дефисами, иначе портал отклонит пачку (400). */
function cleanUser(u?: User): User | undefined {
  if (!u) return undefined
  const out: User = {}
  const id = dashUuid(u.uuid)
  if (id) out.uuid = id
  if (u.name) out.name = u.name
  return out.uuid || out.name ? out : undefined
}

/** Убирает из текста пути (C:\…, /home/…, /Users/…) и обрезает до max. */
export function sanitize(text: string | undefined, max = 200): string | undefined {
  if (!text) return undefined
  let s = String(text)
    .replace(/[A-Za-z]:\\[^\s"']*/g, '…')
    .replace(/\/(?:home|Users|root)\/[^\s"']*/g, '…')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length > max) s = s.slice(0, max)
  return s || undefined
}

let flushing = false
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** Отправляет одну пачку (до 100). Не бросает, ошибки гасит, очередь бережёт. */
export async function flushAnalytics(): Promise<void> {
  if (flushing || !analyticsEnabled()) return
  const queue = readQueue()
  if (!queue.length) return
  flushing = true
  try {
    const token = getPortalToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const batch = queue.slice(0, BATCH)
    const res = await axios.post(ENDPOINT, { events: batch }, { headers, timeout: 10000, validateStatus: () => true })
    // 200 — приняли; 400 — пачка невалидна, повтор бессмыслен → в обоих случаях убираем отправленное.
    // 401/429/5xx/сеть — оставляем до следующего раза.
    if (res.status === 200 || res.status === 400) writeQueue(readQueue().slice(batch.length))
  } catch { /* нет сети — оставляем очередь */ }
  finally { flushing = false }
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => { flushTimer = null; void flushAnalytics() }, 3000)
}

/** Кладёт событие в очередь (если включено) и планирует отправку. Никогда не бросает. */
export function track(type: string, opts: { ref?: string; data?: Record<string, unknown>; user?: User } = {}): void {
  try {
    if (!analyticsEnabled()) return
    const user = cleanUser(opts.user)
    const ev: AEvent = {
      type,
      at: new Date().toISOString(),
      installId: getInstallId(),
      ...(user ? { user } : {}),
      ...(opts.ref ? { ref: opts.ref.slice(0, 80) } : {}),
      ...(opts.data ? { data: opts.data } : {})
    }
    const q = readQueue()
    q.push(ev)
    writeQueue(q.length > QUEUE_MAX ? q.slice(q.length - QUEUE_MAX) : q)
    scheduleFlush()
  } catch { /* аналитика не должна ломать работу */ }
}

// ───────── Конкретные события лаунчера ─────────

export function trackStart(): void {
  const firstLaunch = !store.get('analyticsFirstLaunchDone')
  if (firstLaunch) store.set('analyticsFirstLaunchDone', true)
  const plat = process.platform
  const osName = plat === 'win32' ? 'Windows' : plat === 'darwin' ? 'macOS' : plat === 'linux' ? 'Linux' : String(plat)
  track('start', {
    user: activeUser(),
    data: {
      version: app.getVersion(),
      os: osName,
      osVersion: os.release(),
      arch: process.arch,
      firstLaunch,
      portalLinked: !!getPortalToken()
    }
  })
  void flushAnalytics() // при запуске сразу пробуем отправить накопленное
}

export function trackPackLaunch(ref: string, data: { mcVersion: string; loader: string; memoryMb: number; java?: string }, user?: User): void {
  track('pack_launch', { ref, data, user: user ?? activeUser() })
}

export function trackPackExit(ref: string, data: { seconds: number; exitCode: number; crash?: string }, user?: User): void {
  const d: Record<string, unknown> = { seconds: data.seconds, exitCode: data.exitCode }
  const crash = sanitize(data.crash)
  if (crash) d.crash = crash
  track('pack_exit', { ref, data: d, user: user ?? activeUser() })
  void flushAnalytics() // после выхода из игры — отправляем
}

export function trackInstallError(ref: string, stage: string, message?: string): void {
  const msg = sanitize(message)
  track('install_error', { ref, data: { stage, ...(msg ? { message: msg } : {}) }, user: activeUser() })
}
