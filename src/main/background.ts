import { app, dialog, protocol } from 'electron'
import { join, extname, basename } from 'path'
import { existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync, readFileSync } from 'fs'
import { store } from './store'

// Пользовательский фон лаунчера. Картинку копируем в userData и отдаём в рендер через
// собственный протокол fwbg:// - так не упираемся в file:// и CSP, и не раздуваем store base64.
const SCHEME = 'fwbg'

function bgDir(): string {
  const d = join(app.getPath('userData'), 'backgrounds')
  mkdirSync(d, { recursive: true })
  return d
}

// Кастомные картинки сборок в сайдбаре (по одной на сборку). Тот же протокол fwbg, но хост 'icon':
// fwbg://icon/<filename>. store.packIcons: { <packId>: filename }.
function packIconDir(): string {
  const d = join(app.getPath('userData'), 'packicons')
  mkdirSync(d, { recursive: true })
  return d
}

function mimeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.bmp': return 'image/bmp'
    default: return 'application/octet-stream'
  }
}

/** Регистрирует схему fwbg как привилегированную. ВЫЗЫВАТЬ ДО app.ready. */
export function registerBackgroundSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
  ])
}

/** Отдаёт файл фона по fwbg://local/<filename>. Вызывать ПОСЛЕ app.ready. */
export function registerBackgroundProtocol(): void {
  protocol.handle(SCHEME, req => {
    const url = new URL(req.url)
    const name = basename(decodeURIComponent(url.pathname)) // basename гасит выход за каталог
    const dir = url.host === 'icon' ? packIconDir() : bgDir()
    const file = join(dir, name)
    if (!name || !existsSync(file)) return new Response('not found', { status: 404 })
    return new Response(readFileSync(file), { headers: { 'content-type': mimeFor(extname(file)) } })
  })
}

function wipeBgDir(): void {
  try { for (const f of readdirSync(bgDir())) unlinkSync(join(bgDir(), f)) } catch { /* нечего чистить */ }
}

/** Диалог выбора картинки → копия в userData (один слот). Возвращает имя файла или отмену. */
export async function pickBackground(): Promise<{ filename?: string; cancelled?: boolean }> {
  const res = await dialog.showOpenDialog({
    title: 'Фон лаунчера',
    filters: [{ name: 'Изображения', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths[0]) return { cancelled: true }
  const src = res.filePaths[0]
  const ext = (extname(src) || '.png').toLowerCase()
  wipeBgDir() // держим только текущий фон
  const filename = `bg-${Date.now()}${ext}`
  copyFileSync(src, join(bgDir(), filename))
  store.set('bgImage', filename)
  return { filename }
}

export function clearBackground(): void {
  wipeBgDir()
  store.set('bgImage', null)
}

/** Текущее имя файла фона (или null, если не задан/файл пропал). */
export function getBackground(): string | null {
  const name = store.get('bgImage') as string | null
  if (!name) return null
  return existsSync(join(bgDir(), name)) ? name : null
}

// ——— Картинки сборок ———

function getPackIconMap(): Record<string, string> {
  return (store.get('packIcons') as Record<string, string> | null) ?? {}
}

/** { packId: filename } только для реально существующих файлов. */
export function getPackIcons(): Record<string, string> {
  const map = getPackIconMap()
  const out: Record<string, string> = {}
  for (const [id, name] of Object.entries(map)) {
    if (name && existsSync(join(packIconDir(), name))) out[id] = name
  }
  return out
}

/** Диалог выбора картинки для сборки → копия в userData. Возвращает имя файла или отмену. */
export async function pickPackIcon(packId: string): Promise<{ filename?: string; cancelled?: boolean }> {
  const res = await dialog.showOpenDialog({
    title: 'Картинка сборки',
    filters: [{ name: 'Изображения', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths[0]) return { cancelled: true }
  const src = res.filePaths[0]
  const ext = (extname(src) || '.png').toLowerCase()
  const map = getPackIconMap()
  const old = map[packId]
  if (old) { try { unlinkSync(join(packIconDir(), old)) } catch { /* уже нет */ } }
  const filename = `${packId}-${Date.now()}${ext}`
  copyFileSync(src, join(packIconDir(), filename))
  store.set('packIcons', { ...map, [packId]: filename })
  return { filename }
}

export function clearPackIcon(packId: string): void {
  const map = getPackIconMap()
  const old = map[packId]
  if (old) { try { unlinkSync(join(packIconDir(), old)) } catch { /* уже нет */ } }
  const next = { ...map }
  delete next[packId]
  store.set('packIcons', next)
}
