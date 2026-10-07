import yauzl from 'yauzl'
import { app, nativeImage } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { createHash } from 'crypto'

// Иконка мода/ресурспака прямо из архива (.jar/.zip), когда нет иконки Modrinth.
// Источники по приоритету: Fabric (fabric.mod.json.icon) -> Quilt -> Forge/NeoForge
// (META-INF/mods.toml logoFile) -> resourcepack pack.png.
// Архив не читается целиком (yauzl), иконка уменьшается и кэшируется на диск.

const ICON_SIZE = 96              // px, с запасом под HiDPI
const MAX_ENTRY_BYTES = 4 * 1024 * 1024
const CONCURRENCY = 4

interface Zip {
  read(name: string): Promise<Buffer | null>
  close(): void
}

/** Открывает zip: читает только оглавление, содержимое записей — по запросу. */
function openZip(path: string): Promise<Zip | null> {
  return new Promise(resolve => {
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) return resolve(null)
      const entries = new Map<string, yauzl.Entry>()

      zip.on('entry', (e: yauzl.Entry) => { entries.set(e.fileName, e); zip.readEntry() })
      zip.on('error', () => { try { zip.close() } catch { /* уже закрыт */ } resolve(null) })
      zip.on('end', () => resolve({
        read: name => new Promise(res => {
          const e = entries.get(name.replace(/^\/+/, ''))
          if (!e || e.uncompressedSize > MAX_ENTRY_BYTES) return res(null)
          zip.openReadStream(e, (err2, stream) => {
            if (err2 || !stream) return res(null)
            const chunks: Buffer[] = []
            stream.on('data', (c: Buffer) => chunks.push(c))
            stream.on('end', () => res(Buffer.concat(chunks)))
            stream.on('error', () => res(null))
          })
        }),
        close: () => { try { zip.close() } catch { /* уже закрыт */ } }
      }))
      zip.readEntry()
    })
  })
}

/** Сырые байты иконки из архива (в исходном размере) или null. */
async function findIcon(zip: Zip): Promise<Buffer | null> {
  const readJsonIcon = async (file: string, pick: (j: any) => unknown): Promise<Buffer | null> => {
    const buf = await zip.read(file)
    if (!buf) return null
    try {
      const v = pick(JSON.parse(buf.toString('utf8')))
      const p = typeof v === 'string' ? v : v && typeof v === 'object' ? Object.values(v)[0] : null
      return typeof p === 'string' ? await zip.read(p) : null
    } catch { return null } // битый json - пропускаем
  }

  // Fabric: icon = "assets/mod/icon.png" ИЛИ { "128": "path" }
  const fabric = await readJsonIcon('fabric.mod.json', j => j.icon)
  if (fabric) return fabric

  // Quilt
  const quilt = await readJsonIcon('quilt.mod.json', j => j?.quilt_loader?.metadata?.icon)
  if (quilt) return quilt

  // Forge / NeoForge: logoFile
  const toml = (await zip.read('META-INF/mods.toml')) ?? (await zip.read('META-INF/neoforge.mods.toml'))
  if (toml) {
    const m = /logoFile\s*=\s*["']([^"']+)["']/.exec(toml.toString('utf8'))
    if (m?.[1]) {
      const b = await zip.read(m[1])
      if (b) return b
    }
  }

  // Resourcepack (и часть шейдерпаков)
  return zip.read('pack.png')
}

/** Уменьшает до ICON_SIZE и перекодирует в PNG. Не PNG/JPEG (например gif) -> null. */
function shrink(buf: Buffer): Buffer | null {
  const img = nativeImage.createFromBuffer(buf)
  if (img.isEmpty()) return null
  const { width, height } = img.getSize()
  if (Math.max(width, height) <= ICON_SIZE) return img.toPNG()
  const resized = width >= height
    ? img.resize({ width: ICON_SIZE, quality: 'best' })
    : img.resize({ height: ICON_SIZE, quality: 'best' })
  return resized.toPNG()
}

const toDataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`

async function statAny(base: string): Promise<{ size: number; mtimeMs: number; real: string } | null> {
  // Выключенный мод лежит как X.jar.disabled
  for (const real of [base, base + '.disabled']) {
    try {
      const st = await fs.stat(real)
      return { size: st.size, mtimeMs: st.mtimeMs, real }
    } catch { /* пробуем следующий */ }
  }
  return null
}

async function iconFor(dir: string, name: string): Promise<string | null> {
  try {
    const base = join(dir, name)
    const st = await statAny(base)
    if (!st) return null

    // base (без .disabled) в ключе: включение/выключение мода не сбрасывает кэш
    const key = createHash('sha1').update(`${base}|${st.size}|${st.mtimeMs}`).digest('hex')
    const cacheDir = join(app.getPath('userData'), 'icon-cache')
    const pngFile = join(cacheDir, key + '.png')
    const noneFile = join(cacheDir, key + '.none')

    try { return toDataUrl(await fs.readFile(pngFile)) } catch { /* нет в кэше */ }
    try { await fs.access(noneFile); return null } catch { /* нет и отметки «иконки нет» */ }

    let png: Buffer | null = null
    const zip = await openZip(st.real)
    if (zip) {
      try {
        const raw = await findIcon(zip)
        png = raw ? shrink(raw) : null
      } finally {
        zip.close()
      }
    }

    await fs.mkdir(cacheDir, { recursive: true }).catch(() => {})
    await fs.writeFile(png ? pngFile : noneFile, png ?? '').catch(() => {})
    return png ? toDataUrl(png) : null
  } catch {
    return null
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** filename -> data-URL|null для файлов из папки dir. Пустой ввод -> пустой результат. */
export async function getLocalIcons(dir: string, filenames: string[]): Promise<Record<string, string | null>> {
  const names = [...new Set(filenames.filter(Boolean))]
  const icons = await mapLimit(names, CONCURRENCY, n => iconFor(dir, n))
  return Object.fromEntries(names.map((n, i) => [n, icons[i]]))
}

// ——— Метаданные из архива: автор и версия (для строк модов/паков/шейдеров) ———

export interface LocalMeta { author: string | null; version: string | null }

// Кэш по сигнатуре файла (путь|размер|mtime): переключение вкладок не перечитывает архивы.
const metaCache = new Map<string, LocalMeta>()

/** `${file.jarVersion}` и прочие плейсхолдеры — не настоящая версия. */
const realVersion = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() && !v.includes('${') ? v.trim() : null

/** authors: ["A", {name:"B"}] | "A, B" -> "A, B". */
function parseAuthors(a: unknown): string | null {
  if (typeof a === 'string') return a.trim() || null
  if (Array.isArray(a)) {
    const names = a.map(x => (typeof x === 'string' ? x : (x as { name?: string })?.name)).filter(Boolean) as string[]
    if (names.length) return names.join(', ')
  }
  return null
}

async function metaFromZip(zip: Zip): Promise<LocalMeta> {
  // Fabric
  const fabric = await zip.read('fabric.mod.json')
  if (fabric) {
    try {
      const j = JSON.parse(fabric.toString('utf8'))
      return { author: parseAuthors(j.authors), version: realVersion(j.version) }
    } catch { /* битый json */ }
  }
  // Quilt
  const quilt = await zip.read('quilt.mod.json')
  if (quilt) {
    try {
      const q = JSON.parse(quilt.toString('utf8'))?.quilt_loader
      const contrib = q?.metadata?.contributors
      const author = contrib && typeof contrib === 'object' ? (Object.keys(contrib).join(', ') || null) : parseAuthors(q?.metadata?.authors)
      return { author, version: realVersion(q?.version) }
    } catch { /* битый json */ }
  }
  // Forge / NeoForge: mods.toml
  const toml = (await zip.read('META-INF/mods.toml')) ?? (await zip.read('META-INF/neoforge.mods.toml'))
  if (toml) {
    const s = toml.toString('utf8')
    const author = /authors\s*=\s*["']([^"']+)["']/.exec(s)?.[1]?.trim() || null
    return { author, version: realVersion(/version\s*=\s*["']([^"']+)["']/.exec(s)?.[1]) }
  }
  return { author: null, version: null }
}

async function metaForFile(dir: string, name: string): Promise<LocalMeta> {
  try {
    const st = await statAny(join(dir, name))
    if (!st) return { author: null, version: null }
    const key = `${st.real}|${st.size}|${st.mtimeMs}`
    const cached = metaCache.get(key)
    if (cached) return cached
    let meta: LocalMeta = { author: null, version: null }
    const zip = await openZip(st.real)
    if (zip) {
      try { meta = await metaFromZip(zip) } finally { zip.close() }
    }
    metaCache.set(key, meta)
    return meta
  } catch {
    return { author: null, version: null }
  }
}

/** filename -> {author, version} для архивов в папке dir. */
export async function getLocalMeta(dir: string, filenames: string[]): Promise<Record<string, LocalMeta>> {
  const names = [...new Set(filenames.filter(Boolean))]
  const metas = await mapLimit(names, CONCURRENCY, n => metaForFile(dir, n))
  return Object.fromEntries(names.map((n, i) => [n, metas[i]]))
}

// ——— Определение проекта Modrinth по хэшу файла (для локальных сборок без modrinth_id) ———

// Кэш по сигнатуре файла: project_id|null (null = проверяли, на Modrinth нет).
const srcCache = new Map<string, string | null>()

async function sha1Of(real: string): Promise<string | null> {
  try { return createHash('sha1').update(await fs.readFile(real)).digest('hex') } catch { return null }
}

async function sigAndHash(dir: string, name: string): Promise<{ name: string; key: string; sha1: string | null; cached: boolean }> {
  const st = await statAny(join(dir, name))
  if (!st) return { name, key: '', sha1: null, cached: false }
  const key = `${st.real}|${st.size}|${st.mtimeMs}`
  if (srcCache.has(key)) return { name, key, sha1: null, cached: true }
  return { name, key, sha1: await sha1Of(st.real), cached: false }
}

/** filename -> project_id Modrinth|null, по sha1 файлов. Для локальных .jar/.zip без известного источника. */
export async function resolveLocalModrinth(dir: string, filenames: string[]): Promise<Record<string, string | null>> {
  const names = [...new Set(filenames.filter(Boolean))]
  const out: Record<string, string | null> = {}
  const infos = await mapLimit(names, CONCURRENCY, n => sigAndHash(dir, n))
  const toQuery = infos.filter(i => !i.cached && i.sha1)
  const { getProjectIdsByHashes } = await import('./modrinth')
  const map = toQuery.length ? await getProjectIdsByHashes(toQuery.map(i => i.sha1 as string)) : {}
  for (const i of infos) {
    if (i.cached) { out[i.name] = srcCache.get(i.key) ?? null; continue }
    const pid = i.sha1 ? (map[i.sha1] ?? null) : null
    if (i.key) srcCache.set(i.key, pid)
    out[i.name] = pid
  }
  return out
}