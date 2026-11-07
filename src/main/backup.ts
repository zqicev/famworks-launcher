import AdmZip from 'adm-zip'
import { app } from 'electron'
import { join, dirname, resolve, sep } from 'path'
import { existsSync, mkdirSync, readdirSync, statSync, rmSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { createHash } from 'crypto'
import { packDir } from './packpaths'
import { store } from './store'
import { featureEnabled } from './flags'
import { getVersionsByHashes } from './modrinth'
import { downloadModToDir } from './installer'

// Резервные копии сборок по КАТЕГОРИЯМ. Миры/настройки/скриншоты — кладём целиком. Моды/ресурспаки/
// шейдеры — умно: что есть на Modrinth, запоминаем СПИСКОМ (ссылка на файл) и докачиваем при
// восстановлении; локальные файлы и папки — кладём в копию как есть. Копии лежат вне папки игры/программы.

export type Category = 'worlds' | 'settings' | 'screenshots' | 'mods' | 'resourcepacks' | 'shaders'
export const ALL_CATEGORIES: Category[] = ['worlds', 'settings', 'screenshots', 'mods', 'resourcepacks', 'shaders']
const CODE: Record<Category, string> = { worlds: 'w', settings: 's', screenshots: 'c', mods: 'm', resourcepacks: 'r', shaders: 'h' }
const BY_CODE: Record<string, Category> = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k as Category]))

// «Умные» категории: папка игры, где Modrinth-файлы запоминаем списком.
const SMART: Partial<Record<Category, string>> = { mods: 'mods', resourcepacks: 'resourcepacks', shaders: 'shaderpacks' }

// В «Настройки» кладём ВСЁ из папки игры, кроме перекачиваемого/регенерируемого и других категорий.
// Так попадают не только config/ и options.txt, но и папки, которые моды создают сами (journeymap,
// xaero-вейпоинты, schematics и т.п.).
const SETTINGS_EXCLUDE = new Set([
  'saves', 'screenshots', 'mods', 'resourcepacks', 'shaderpacks',
  'versions', 'libraries', 'assets', 'natives', 'logs', 'crash-reports', 'crash_reports',
  '.loader', '.fabric', '.mixin.out', 'runtime'
])

function settingsItems(gameRoot: string): string[] {
  try { return readdirSync(gameRoot).filter((n) => !SETTINGS_EXCLUDE.has(n)) } catch { return [] }
}

/** Файлы/папки «простой» категории (кладём целиком). «Настройки» — всё, кроме исключённого. */
function plainItems(cat: Category, gameRoot: string): string[] | null {
  if (cat === 'worlds') return ['saves']
  if (cat === 'screenshots') return ['screenshots']
  if (cat === 'settings') return settingsItems(gameRoot)
  return null
}

const AUTO_KEEP = 2                         // авто-копий на сборку (последние N сессий, по кругу)
const MANUAL_KEEP = 20                      // ручных копий на сборку (живут, пока не удалишь)
const NO_WORLD_THROTTLE = 2 * 3600 * 1000   // серверная сборка без миров — не чаще раза в ~2ч
const AUTO_SIZE_CAP = 2 * 1024 * 1024 * 1024 // авто пропускаем, если миров/скринов/конфигов > 2 ГБ

/** Самое свежее изменение миров (mtime level.dat/session.lock). 0 — миров нет. */
function savesNewestMtime(gameRoot: string): number {
  const dir = join(gameRoot, 'saves')
  if (!existsSync(dir)) return 0
  let newest = 0
  try {
    for (const w of readdirSync(dir)) {
      for (const f of ['level.dat', 'session.lock']) {
        try { const m = statSync(join(dir, w, f)).mtimeMs; if (m > newest) newest = m } catch { /* нет файла */ }
      }
    }
  } catch { /* нет папки */ }
  return newest
}

export interface BackupInfo { file: string; at: number; sizeBytes: number; reason: string; categories: Category[] }

interface AssetEntry { folder: string; filename: string; enabled: boolean; url: string; sha512?: string } // только Modrinth
type ModCacheVal = { sha1: string; source: 'modrinth' | 'local'; url?: string; sha512?: string }
type ModCache = Record<string, ModCacheVal>

/** Автосохранение включено для конкретной сборки (по умолчанию да). */
export function autoBackupEnabled(packId: string): boolean {
  const map = (store.get('backupAuto') as Record<string, boolean>) || {}
  return map[packId] !== false
}
export function setAutoBackup(packId: string, v: boolean): void {
  const map = { ...((store.get('backupAuto') as Record<string, boolean>) || {}) }
  map[packId] = v
  store.set('backupAuto', map)
}
/** Карта «сборка → автосохранение» (только явно заданные; отсутствие = включено). */
export function autoBackupMap(): Record<string, boolean> {
  return (store.get('backupAuto') as Record<string, boolean>) || {}
}

/** Папка копий по умолчанию — рядом со сборками (installPath/backups). installPath защищён от выбора
 *  папки лаунчера, так что обновление её не трогает. Если путь ещё не задан — временно userData. */
export function defaultBackupDir(): string {
  const installPath = ((store.get('installPath') as string | undefined) || '').trim()
  return installPath ? join(installPath, 'backups') : join(app.getPath('userData'), 'backups')
}

function backupsRoot(): string {
  const custom = ((store.get('backupDir') as string | undefined) || '').trim()
  return custom || defaultBackupDir()
}
function packBackupDir(packId: string): string { return join(backupsRoot(), packId) }

function parseInfo(dir: string, file: string): BackupInfo {
  const m = file.match(/^(\d+)__([a-z]+)(?:__([a-z]*))?\.zip$/i)
  let size = 0
  try { size = statSync(join(dir, file)).size } catch { /* ignore */ }
  const cats = (m?.[3] || '').split('').map((c) => BY_CODE[c]).filter(Boolean) as Category[]
  return { file, at: m ? Number(m[1]) : 0, sizeBytes: size, reason: m ? m[2] : 'manual', categories: cats }
}

export function listBackups(packId: string): BackupInfo[] {
  const dir = packBackupDir(packId)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.zip')).map((f) => parseInfo(dir, f)).sort((a, b) => b.at - a.at)
}

export function listAllBackups(): Record<string, BackupInfo[]> {
  const root = backupsRoot()
  if (!existsSync(root)) return {}
  const out: Record<string, BackupInfo[]> = {}
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    const list = listBackups(d.name)
    if (list.length) out[d.name] = list
  }
  return out
}

/** Ротация РАЗДЕЛЬНО: авто (не manual) до AUTO_KEEP, ручные до MANUAL_KEEP — авто не затирают ручные. */
function rotate(packId: string): void {
  const list = listBackups(packId)
  const auto = list.filter((b) => b.reason !== 'manual').slice(AUTO_KEEP)
  const manual = list.filter((b) => b.reason === 'manual').slice(MANUAL_KEEP)
  for (const b of [...auto, ...manual]) {
    try { rmSync(join(packBackupDir(packId), b.file), { force: true }) } catch { /* ignore */ }
  }
}

function sizeUnder(paths: string[], cap: number): number {
  let total = 0
  const walk = (p: string): void => {
    if (total > cap) return
    let st: ReturnType<typeof statSync>
    try { st = statSync(p) } catch { return }
    if (st.isDirectory()) {
      let ents: string[]
      try { ents = readdirSync(p) } catch { return }
      for (const e of ents) { if (total > cap) return; walk(join(p, e)) }
    } else { total += st.size }
  }
  for (const p of paths) { if (total > cap) break; walk(p) }
  return total
}

/** Разбор «умной» папки: Modrinth-файлы → список, локальные файлы/папки → имена для укладки в архив. */
async function collectAssets(gameRoot: string, folder: string): Promise<{ modrinth: AssetEntry[]; local: string[] }> {
  const dir = join(gameRoot, folder)
  if (!existsSync(dir)) return { modrinth: [], local: [] }
  let ents: import('fs').Dirent[]
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return { modrinth: [], local: [] } }

  const cache: ModCache = (store.get('modResolveCache') as ModCache) || {}
  const fileItems: { onDisk: string; base: string; enabled: boolean; key: string }[] = []
  const local: string[] = []
  for (const e of ents) {
    if (e.isDirectory()) { local.push(e.name); continue }                 // папка (напр. ресурспак) → как есть
    if (!/\.(jar|zip)(\.disabled)?$/i.test(e.name)) { local.push(e.name); continue } // прочее → как есть
    const base = e.name.replace(/\.disabled$/i, '')
    const enabled = !/\.disabled$/i.test(e.name)
    let st: ReturnType<typeof statSync>
    try { st = statSync(join(dir, e.name)) } catch { continue }
    fileItems.push({ onDisk: e.name, base, enabled, key: `${folder}:${base}|${st.size}|${Math.round(st.mtimeMs)}` })
  }

  const toHash = fileItems.filter((it) => !cache[it.key])
  const sha1ByKey: Record<string, string> = {}
  for (const it of toHash) {
    try { sha1ByKey[it.key] = createHash('sha1').update(readFileSync(join(dir, it.onDisk))).digest('hex') } catch { /* unreadable → local */ }
  }
  const sha1s = Object.values(sha1ByKey)
  let resolved: Awaited<ReturnType<typeof getVersionsByHashes>> = {}
  if (sha1s.length) { try { resolved = await getVersionsByHashes(sha1s) } catch { resolved = {} } }
  for (const it of toHash) {
    const sha1 = sha1ByKey[it.key]
    if (!sha1) { cache[it.key] = { sha1: '', source: 'local' }; continue }
    const v = resolved[sha1]
    const f = v?.files?.find((x) => x.primary) ?? v?.files?.[0]
    cache[it.key] = v && f?.url ? { sha1, source: 'modrinth', url: f.url, sha512: f.hashes?.sha512 } : { sha1, source: 'local' }
  }
  if (Object.keys(cache).length > 5000) store.set('modResolveCache', {}) // предохранитель от разрастания
  else store.set('modResolveCache', cache as Record<string, unknown>)

  const modrinth: AssetEntry[] = []
  for (const it of fileItems) {
    const c = cache[it.key]
    if (c?.source === 'modrinth' && c.url) modrinth.push({ folder, filename: it.base, enabled: it.enabled, url: c.url, sha512: c.sha512 })
    else local.push(it.onDisk) // локальный файл кладём под его именем (с .disabled, если выключен)
  }
  return { modrinth, local }
}

/** Создаёт копию выбранных категорий. categories — что включить (по умолчанию всё). */
export async function createBackup(packId: string, reason = 'manual', categories: Category[] = ALL_CATEGORIES): Promise<string | null> {
  const gameRoot = packDir(packId)
  if (!existsSync(gameRoot)) return null

  const zip = new AdmZip()
  const included: Category[] = []

  for (const cat of categories) {
    const plain = plainItems(cat, gameRoot)
    if (!plain) continue
    let any = false
    for (const item of plain) {
      const p = join(gameRoot, item)
      if (!existsSync(p)) continue
      try {
        if (statSync(p).isDirectory()) zip.addLocalFolder(p, item)
        else zip.addLocalFile(p)
        any = true
      } catch { /* занят */ }
    }
    if (any) included.push(cat)
  }

  const assets: AssetEntry[] = []
  for (const cat of categories) {
    const folder = SMART[cat]
    if (!folder) continue
    const { modrinth, local } = await collectAssets(gameRoot, folder)
    if (!modrinth.length && !local.length) continue
    assets.push(...modrinth)
    const dir = join(gameRoot, folder)
    for (const name of local) {
      const p = join(dir, name)
      try {
        if (statSync(p).isDirectory()) zip.addLocalFolder(p, `local/${folder}/${name}`)
        else zip.addLocalFile(p, `local/${folder}`, name)
      } catch { /* занят */ }
    }
    included.push(cat)
  }

  if (!included.length) return null
  if (assets.length) zip.addFile('assets.json', Buffer.from(JSON.stringify({ assets }), 'utf8'))
  zip.addFile('meta.json', Buffer.from(JSON.stringify({ categories: included }), 'utf8'))

  const dir = packBackupDir(packId)
  mkdirSync(dir, { recursive: true })
  const codes = included.map((c) => CODE[c]).join('')
  const file = `${Date.now()}__${reason.replace(/[^a-z]/gi, '') || 'manual'}__${codes}.zip`
  try { zip.writeZip(join(dir, file)) } catch { return null }
  rotate(packId)
  return join(dir, file)
}

/** Авто-копия после игры: по копии на каждую сессию с изменившимся миром. Возвращает статус (для логов). */
export async function maybeAutoBackup(packId: string): Promise<string> {
  try {
    if (!autoBackupEnabled(packId)) return 'автосохранение выключено для сборки'
    if (!featureEnabled('autoBackup')) return 'отключено удалённым флагом'
    const gameRoot = packDir(packId)
    // Копия на КАЖДУЮ сессию, где мир менялся. Защита от «пустых» копий: если с прошлой авто-копии мир
    // не изменился (а для серверных сборок без миров — прошло мало времени), пропускаем. Ручные/версионные
    // копии троттлинг не учитывает.
    const lastAuto = listBackups(packId).find((b) => b.reason === 'auto')
    if (lastAuto) {
      const newest = savesNewestMtime(gameRoot)
      if (newest > 0) {
        if (newest <= lastAuto.at) return 'мир не менялся с прошлой авто-копии'
      } else if (Date.now() - lastAuto.at < NO_WORLD_THROTTLE) {
        return 'без миров: конфиги недавно уже сохранены'
      }
    }
    // Грубый предохранитель по весу: миры/скрины/конфиги (умные категории почти не весят — список).
    const heavy = ['saves', 'screenshots', 'config'].map((d) => join(gameRoot, d)).filter((p) => existsSync(p))
    if (heavy.length && sizeUnder(heavy, AUTO_SIZE_CAP) > AUTO_SIZE_CAP) return 'слишком большой объём миров/скриншотов'
    const r = await createBackup(packId, 'auto')
    return r ? 'авто-копия создана' : 'нечего сохранять (нет данных)'
  } catch (e) {
    return 'ошибка: ' + String(e)
  }
}

function insideRoot(target: string, root: string): boolean {
  const r = resolve(root)
  const t = resolve(target)
  return t === r || t.startsWith(r + sep)
}

/** Восстанавливает категории из копии: простые — из архива, умные — чистим папку и возвращаем набор
 *  (Modrinth докачкой, локальные из архива). Перед заменой делает копию текущего состояния. */
export async function restoreBackup(packId: string, file: string): Promise<{ ok: boolean; error?: string }> {
  const zipPath = join(packBackupDir(packId), file)
  if (!existsSync(zipPath)) return { ok: false, error: 'Копия не найдена' }
  try {
    await createBackup(packId, 'prerestore') // страховка текущего состояния (все категории)
    const gameRoot = packDir(packId)
    mkdirSync(gameRoot, { recursive: true })
    const zip = new AdmZip(zipPath)

    let meta: { categories?: Category[] } = {}
    let assets: AssetEntry[] = []
    for (const e of zip.getEntries()) {
      if (e.entryName === 'meta.json') { try { meta = JSON.parse(e.getData().toString('utf8')) } catch { /* битый */ } }
      else if (e.entryName === 'assets.json') { try { assets = JSON.parse(e.getData().toString('utf8')).assets || [] } catch { /* битый */ } }
    }
    const cats = meta.categories || []

    // Умные папки, что входят в копию, очищаем — вернём ровно их набор.
    for (const cat of cats) {
      const folder = SMART[cat]
      if (!folder) continue
      const d = join(gameRoot, folder)
      try { for (const n of readdirSync(d)) rmSync(join(d, n), { recursive: true, force: true }) } catch { /* нет папки */ }
    }

    // Файлы из архива: простые — на своё место; local/<folder>/… — в <folder>/… (срезаем префикс local/).
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue
      const name = e.entryName
      if (name === 'meta.json' || name === 'assets.json') continue
      const rel = name.startsWith('local/') ? name.slice('local/'.length) : name
      const target = join(gameRoot, rel)
      if (!insideRoot(target, gameRoot)) continue // zip-slip защита
      try { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, e.getData()) } catch { /* один файл не встал */ }
    }

    // Modrinth-файлы умных категорий — докачиваем.
    for (const a of assets) {
      try {
        const d = join(gameRoot, a.folder)
        mkdirSync(d, { recursive: true })
        await downloadModToDir(a.url, a.filename, d, undefined, a.sha512)
        if (!a.enabled) { try { renameSync(join(d, a.filename), join(d, `${a.filename}.disabled`)) } catch { /* ignore */ } }
      } catch { /* один файл не докачался — продолжаем */ }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export function deleteBackup(packId: string, file: string): { ok: boolean } {
  try { rmSync(join(packBackupDir(packId), file), { force: true }); return { ok: true } } catch { return { ok: false } }
}
