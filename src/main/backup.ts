import { app } from 'electron'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, readdirSync, statSync, rmSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { mkdir, readdir, copyFile, stat } from 'fs/promises'
import { packDir } from './packpaths'
import { store } from './store'
import { featureEnabled } from './flags'

/** Надёжная рекурсивная копия (не зависим от экспериментального fs.cp). Возвращает скопированные байты.
 *  Залоченный/битый файл пропускаем, остальное копируем. */
async function copyTree(src: string, dest: string): Promise<number> {
  let st: Awaited<ReturnType<typeof stat>>
  try { st = await stat(src) } catch { return 0 }
  if (st.isDirectory()) {
    let bytes = 0
    try { await mkdir(dest, { recursive: true }) } catch { return 0 }
    let names: string[]
    try { names = await readdir(src) } catch { return bytes }
    for (const n of names) bytes += await copyTree(join(src, n), join(dest, n))
    return bytes
  }
  try { await mkdir(dirname(dest), { recursive: true }); await copyFile(src, dest); return st.size } catch { return 0 }
}

// Резервные копии сборок по КАТЕГОРИЯМ. Храним как ПАПКИ с файлами (копируем, не зипуем): не грузим память
// и не морозим интерфейс даже на больших мирах, лимит на размер не нужен. Все категории (включая моды/
// ресурспаки/шейдеры) кладутся файлами — копия самодостаточна, восстановление работает без сети.
// Папка копий сборки называется по её имени (не по id). Копии лежат вне папки игры/программы.

export type Category = 'worlds' | 'settings' | 'screenshots' | 'mods' | 'resourcepacks' | 'shaders'
export const ALL_CATEGORIES: Category[] = ['worlds', 'settings', 'screenshots', 'mods', 'resourcepacks', 'shaders']

// Папка игры для категории ('settings' — динамически). При восстановлении CLEAR_ON_RESTORE чистим, чтобы
// вернуть ровно набор из копии.
const FOLDER: Record<Category, string | null> = {
  worlds: 'saves', screenshots: 'screenshots', settings: null, mods: 'mods', resourcepacks: 'resourcepacks', shaders: 'shaderpacks'
}
const CLEAR_ON_RESTORE = new Set<Category>(['mods', 'resourcepacks', 'shaders'])

// В «Настройки» кладём ВСЁ из папки игры, кроме перекачиваемого/других категорий — попадают config/ и
// папки, которые моды создают сами (journeymap, xaero-вейпоинты, schematics и т.п.).
const SETTINGS_EXCLUDE = new Set([
  'saves', 'screenshots', 'mods', 'resourcepacks', 'shaderpacks',
  'versions', 'libraries', 'assets', 'natives', 'logs', 'crash-reports', 'crash_reports',
  '.loader', '.fabric', '.mixin.out', 'runtime'
])

function catItems(cat: Category, gameRoot: string): string[] {
  if (cat === 'settings') {
    try { return readdirSync(gameRoot).filter((n) => !SETTINGS_EXCLUDE.has(n)) } catch { return [] }
  }
  const f = FOLDER[cat]
  return f ? [f] : []
}

const AUTO_KEEP = 2     // авто-копий (по одной на день) на сборку, по кругу
const MANUAL_KEEP = 20  // ручных копий на сборку (живут, пока не удалишь)

export interface BackupInfo { file: string; at: number; sizeBytes: number; reason: string; categories: Category[] }
interface Meta { categories: Category[]; at: number; reason: string; sizeBytes: number }

/** Ключ сегодняшнего дня (полночь, ms) — им называем дневную авто-копию. */
function dayKey(): number { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }

/** Рекурсивный размер папки (для meta). */
async function sizeDir(dir: string): Promise<number> {
  let total = 0
  let ents: import('fs').Dirent[]
  try { ents = await readdir(dir, { withFileTypes: true }) } catch { return 0 }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) total += await sizeDir(p)
    else { try { total += (await stat(p)).size } catch { /* ignore */ } }
  }
  return total
}

/** Относительные пути миров, в которые играли с момента since (mtime level.dat/session.lock). */
function changedWorlds(gameRoot: string, since: number): string[] {
  const dir = join(gameRoot, 'saves')
  if (!existsSync(dir)) return []
  const out: string[] = []
  try {
    for (const w of readdirSync(dir)) {
      let newest = 0
      for (const f of ['level.dat', 'session.lock']) {
        try { const m = statSync(join(dir, w, f)).mtimeMs; if (m > newest) newest = m } catch { /* нет файла */ }
      }
      if (newest >= since) out.push(join('saves', w))
    }
  } catch { /* ignore */ }
  return out
}

// ───────── Настройки автосохранения ─────────
export function autoBackupGlobal(): boolean { return store.get('backupAutoGlobal') !== false }
export function setAutoBackupGlobal(v: boolean): void { store.set('backupAutoGlobal', v) }
export function backupAsked(): boolean { return store.get('backupAskDone') === true }
export function answerBackupAsk(enable: boolean): void { store.set('backupAutoGlobal', !!enable); store.set('backupAskDone', true) }
export function autoBackupEnabled(packId: string): boolean {
  if (!autoBackupGlobal()) return false
  return ((store.get('backupAuto') as Record<string, boolean>) || {})[packId] !== false
}
export function setAutoBackup(packId: string, v: boolean): void {
  const map = { ...((store.get('backupAuto') as Record<string, boolean>) || {}) }
  map[packId] = v
  store.set('backupAuto', map)
}
export function autoBackupMap(): Record<string, boolean> { return (store.get('backupAuto') as Record<string, boolean>) || {} }

/** Какие категории авто-сохранять для сборки (по умолчанию — все). */
export function autoBackupCats(packId: string): Category[] {
  const m = (store.get('backupAutoCats') as Record<string, Category[]>) || {}
  const v = m[packId]
  return Array.isArray(v) ? (v.filter((c) => ALL_CATEGORIES.includes(c)) as Category[]) : ALL_CATEGORIES
}
export function setAutoBackupCats(packId: string, cats: Category[]): void {
  const m = { ...((store.get('backupAutoCats') as Record<string, Category[]>) || {}) }
  m[packId] = cats.filter((c) => ALL_CATEGORIES.includes(c))
  store.set('backupAutoCats', m)
}
export function autoBackupCatsMap(): Record<string, Category[]> { return (store.get('backupAutoCats') as Record<string, Category[]>) || {} }

// ───────── Расположение копий ─────────
export function defaultBackupDir(): string {
  const installPath = ((store.get('installPath') as string | undefined) || '').trim()
  return installPath ? join(installPath, 'backups') : join(app.getPath('userData'), 'backups')
}
function backupsRoot(): string {
  const custom = ((store.get('backupDir') as string | undefined) || '').trim()
  return custom || defaultBackupDir()
}
function folderMap(): Record<string, string> { return (store.get('backupFolders') as Record<string, string>) || {} }

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g
function sanitizeName(s: string): string { return s.replace(ILLEGAL, '').replace(/[.\s]+$/, '').trim() }

/** Имя папки копий для сборки (по названию). Фиксируется в маппинге; легаси-папку (id) переименовывает. */
function resolveBackupFolder(packId: string, displayName?: string): string {
  const map = { ...folderMap() }
  if (map[packId]) return map[packId]
  let name = (displayName ? sanitizeName(displayName) : '') || packId
  const taken = new Set(Object.entries(map).filter(([k]) => k !== packId).map(([, v]) => v))
  const root = backupsRoot()
  if (name !== packId && (taken.has(name) || existsSync(join(root, name)))) name = `${name} (${packId})`
  // Переименуем старую папку packId в человекочитаемую, если она есть, а целевой ещё нет.
  const legacy = join(root, packId)
  if (name !== packId && existsSync(legacy) && !existsSync(join(root, name))) {
    try { renameSync(legacy, join(root, name)) } catch { name = packId }
  }
  map[packId] = name
  store.set('backupFolders', map)
  return name
}
function folderOf(packId: string): string { return folderMap()[packId] || packId }
function packBackupDir(packId: string): string { return join(backupsRoot(), folderOf(packId)) }

function readMeta(backupDir: string): Meta | null {
  try { return JSON.parse(readFileSync(join(backupDir, 'meta.json'), 'utf8')) } catch { return null }
}
function parseInfo(dir: string, name: string): BackupInfo {
  const meta = readMeta(join(dir, name))
  const m = name.match(/^(\d+)__([a-z]+)$/i)
  return {
    file: name,
    at: meta?.at ?? (m ? Number(m[1]) : 0),
    sizeBytes: meta?.sizeBytes ?? 0,
    reason: meta?.reason ?? (m ? m[2] : 'manual'),
    categories: meta?.categories ?? []
  }
}
function listInDir(dir: string): BackupInfo[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+__[a-z]+$/i.test(d.name))
    .map((d) => parseInfo(dir, d.name))
    .sort((a, b) => b.at - a.at)
}
export function listBackups(packId: string): BackupInfo[] { return listInDir(packBackupDir(packId)) }

export function listAllBackups(): Record<string, BackupInfo[]> {
  const root = backupsRoot()
  if (!existsSync(root)) return {}
  const f2p: Record<string, string> = {}
  for (const [pid, folder] of Object.entries(folderMap())) f2p[folder] = pid
  const out: Record<string, BackupInfo[]> = {}
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    const list = listInDir(join(root, d.name))
    if (list.length) out[f2p[d.name] || d.name] = list
  }
  return out
}

function rotate(packId: string): void {
  const list = listBackups(packId)
  const auto = list.filter((b) => b.reason !== 'manual').slice(AUTO_KEEP)
  const manual = list.filter((b) => b.reason === 'manual').slice(MANUAL_KEEP)
  for (const b of [...auto, ...manual]) {
    try { rmSync(join(packBackupDir(packId), b.file), { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

/** Создаёт копию выбранных категорий (папкой). categories — что включить (по умолчанию всё). */
export async function createBackup(packId: string, reason = 'manual', categories: Category[] = ALL_CATEGORIES, displayName?: string): Promise<string | null> {
  const gameRoot = packDir(packId)
  if (!existsSync(gameRoot)) return null

  const included: Category[] = []
  const toCopy: string[] = []
  for (const cat of categories) {
    let any = false
    for (const item of catItems(cat, gameRoot)) {
      if (!existsSync(join(gameRoot, item))) continue
      toCopy.push(item)
      any = true
    }
    if (any) included.push(cat)
  }
  if (!included.length) return null

  const at = Date.now()
  const dir = join(backupsRoot(), resolveBackupFolder(packId, displayName))
  const backupDir = join(dir, `${at}__${reason.replace(/[^a-z]/gi, '') || 'manual'}`)
  mkdirSync(backupDir, { recursive: true })
  let sizeBytes = 0
  for (const rel of toCopy) {
    sizeBytes += await copyTree(join(gameRoot, rel), join(backupDir, rel))
  }

  try { writeFileSync(join(backupDir, 'meta.json'), JSON.stringify({ categories: included, at, reason, sizeBytes } as Meta)) } catch { /* ignore */ }

  rotate(packId)
  return backupDir
}

const CAT_RU: Record<Category, string> = {
  worlds: 'миры', settings: 'настройки', screenshots: 'скриншоты', mods: 'моды', resourcepacks: 'ресурспаки', shaders: 'шейдеры'
}

// Сейчас идёт авто-копия (чтобы запрещать запуск сборки, пока оно не закончится).
const running = new Map<string, Promise<void>>()
export function isBackingUp(packId: string): boolean { return running.has(packId) }
export async function waitForBackup(packId: string): Promise<void> {
  const p = running.get(packId)
  if (p) await p.catch(() => {})
}

/** Докопировать категории в СЕГОДНЯШНЮЮ авто-копию с прогрессом (подпись категории) в окно. */
async function runDailyBackup(packId: string, groups: { cat: Category; rels: string[] }[], displayName: string | undefined, win?: import('electron').BrowserWindow): Promise<string> {
  if (!autoBackupEnabled(packId)) return 'автосохранение выключено'
  if (!featureEnabled('autoBackup')) return 'отключено удалённым флагом'
  const gameRoot = packDir(packId)
  const allowed = new Set(autoBackupCats(packId)) // выбор категорий пользователя для этой сборки
  const real = groups
    .map((g) => ({ cat: g.cat, rels: g.rels.filter((r) => existsSync(join(gameRoot, r))) }))
    .filter((g) => g.rels.length && allowed.has(g.cat))
  if (!real.length) return 'нечего сохранять (нет выбранных категорий)'

  const dir = join(backupsRoot(), resolveBackupFolder(packId, displayName), `${dayKey()}__auto`)
  const sendProg = (label: string | null): void => { try { win?.webContents.send('backup:progress', { packId, label }) } catch { /* окно закрыто */ } }
  const task = (async () => {
    mkdirSync(dir, { recursive: true })
    for (const g of real) {
      sendProg(CAT_RU[g.cat])
      for (const rel of g.rels) await copyTree(join(gameRoot, rel), join(dir, rel))
    }
    const prev = readMeta(dir)
    const categories = [...new Set([...(prev?.categories || []), ...real.map((g) => g.cat)])] as Category[]
    const sizeBytes = await sizeDir(dir)
    try { writeFileSync(join(dir, 'meta.json'), JSON.stringify({ categories, at: Date.now(), reason: 'auto', sizeBytes } as Meta)) } catch { /* ignore */ }
    rotate(packId)
  })()
  running.set(packId, task.then(() => {}, () => {}))
  try { await task } finally { running.delete(packId); sendProg(null) }
  return `сохранено (${real.map((g) => CAT_RU[g.cat]).join(', ')})`
}

/** После УДАЧНОЙ загрузки сборки (игра стартовала, не вылетела) — моды/ресурспаки/шейдеры/настройки/скрины. */
export async function backupOnLoad(packId: string, displayName: string | undefined, win?: import('electron').BrowserWindow): Promise<string> {
  try {
    const gameRoot = packDir(packId)
    const groups = (['mods', 'resourcepacks', 'shaders', 'settings', 'screenshots'] as Category[]).map((c) => ({ cat: c, rels: catItems(c, gameRoot) }))
    return 'загрузка: ' + await runDailyBackup(packId, groups, displayName, win)
  } catch (e) { return 'ошибка: ' + String(e) }
}

/** После ВЫХОДА из игры — сыгранные миры; если не крашнулось — ещё моды/конфиги (jar-ники уже свободны). */
export async function backupOnExit(packId: string, displayName: string | undefined, since: number, crashed: boolean, win?: import('electron').BrowserWindow): Promise<string> {
  try {
    const gameRoot = packDir(packId)
    const groups: { cat: Category; rels: string[] }[] = []
    const worlds = changedWorlds(gameRoot, since)
    if (worlds.length) groups.push({ cat: 'worlds', rels: worlds })
    if (!crashed) for (const c of ['mods', 'resourcepacks', 'shaders', 'settings', 'screenshots'] as Category[]) groups.push({ cat: c, rels: catItems(c, gameRoot) })
    if (!groups.length) return 'выход: мир не менялся'
    return 'выход: ' + await runDailyBackup(packId, groups, displayName, win)
  } catch (e) { return 'ошибка: ' + String(e) }
}

/** Восстанавливает категории из копии: умные (моды/рес/шейдеры) — чистим папку и копируем из копии;
 *  простые — копируем назад. Перед заменой делает копию текущего состояния. */
export async function restoreBackup(packId: string, file: string): Promise<{ ok: boolean; error?: string }> {
  const backupDir = join(packBackupDir(packId), file)
  if (!existsSync(backupDir)) return { ok: false, error: 'Копия не найдена' }
  try {
    await createBackup(packId, 'prerestore')
    const gameRoot = packDir(packId)
    mkdirSync(gameRoot, { recursive: true })
    const cats = readMeta(backupDir)?.categories || []

    for (const cat of cats) {
      if (!CLEAR_ON_RESTORE.has(cat)) continue
      const folder = FOLDER[cat]
      if (!folder) continue
      const d = join(gameRoot, folder)
      try { for (const n of readdirSync(d)) rmSync(join(d, n), { recursive: true, force: true }) } catch { /* нет папки */ }
    }

    for (const name of readdirSync(backupDir)) {
      if (name === 'meta.json') continue
      await copyTree(join(backupDir, name), join(gameRoot, name))
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export function deleteBackup(packId: string, file: string): { ok: boolean } {
  try { rmSync(join(packBackupDir(packId), file), { recursive: true, force: true }); return { ok: true } } catch { return { ok: false } }
}

/** Полный путь к папке конкретной копии (для «открыть в проводнике»). */
export function backupPath(packId: string, file: string): string { return join(packBackupDir(packId), file) }
