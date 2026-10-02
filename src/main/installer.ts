import { join, dirname, resolve, sep } from 'path'
import { createWriteStream, createReadStream, existsSync, mkdirSync, renameSync, unlinkSync, readdirSync, statSync, writeFileSync, readFileSync } from 'fs'
import { createHash } from 'crypto'
import axios from 'axios'
import AdmZip from 'adm-zip'
import { BrowserWindow } from 'electron'
import { Modpack, Mod, ConfigFile } from '../types/modpack'
import { opSignal, isCancelled } from './abort'
import { loaderInstalled } from './loaders'
import { store } from './store'
import { resolveFamworks, FwResolve } from './portalMods'
import { otherVersions, fileKey } from './modFiles'

interface ResolvedMod {
  url: string
  sha512?: string
  sha1?: string
}

/** Считает хэш файла (hex) потоково, без загрузки целиком в память. */
function hashFile(path: string, algo: 'sha512' | 'sha1'): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algo)
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

export interface ProgressEvent {
  phase: 'check' | 'download' | 'done' | 'error'
  message: string
  current?: number
  total?: number
  bytesDownloaded?: number
  bytesTotal?: number
  speedBps?: number
}

function emit(win: BrowserWindow, event: ProgressEvent) {
  win.webContents.send('install:progress', event)
}

// ───────────────────────── Моды FamWorks (источник — портал) ─────────────────────────

interface FwItem { item: Mod; dir: string }
interface FwTrack { filename: string; sha512: string }

/** Элементы сборки (моды/ресурспаки/шейдеры) с famworks_id + папка каждого. */
function collectFamworksItems(modpack: Modpack, gameRoot: string): FwItem[] {
  const out: FwItem[] = []
  for (const m of modpack.mods) if (m.famworks_id) out.push({ item: m, dir: join(gameRoot, 'mods') })
  for (const p of modpack.resourcepacks ?? []) if (p.famworks_id) out.push({ item: p, dir: join(gameRoot, 'resourcepacks') })
  for (const s of modpack.shaders ?? []) if (s.famworks_id) out.push({ item: s, dir: join(gameRoot, 'shaderpacks') })
  return out
}

function fwTrackPath(gameRoot: string): string { return join(gameRoot, '.famworks-mods.json') }
function readFwTracking(gameRoot: string): Record<string, FwTrack> {
  try { return JSON.parse(readFileSync(fwTrackPath(gameRoot), 'utf8')) } catch { return {} }
}
function writeFwTracking(gameRoot: string, map: Record<string, FwTrack>): void {
  try { writeFileSync(fwTrackPath(gameRoot), JSON.stringify(map, null, 2)) } catch { /* не критично */ }
}

/** Выбор ветки test/release для famworks-модов этой сборки (из electron-store). */
function packChannels(modpackId: string): Record<string, string> {
  const all = (store.get('famworksChannels') as Record<string, Record<string, string>> | undefined) ?? {}
  return all[modpackId] ?? {}
}

// Один /resolve на сборку, с коротким кэшем — чтобы проверка статуса и установка не дёргали портал дважды.
const fwResolveCache = new Map<string, { at: number; data: FwResolve }>()
async function resolveForPack(modpack: Modpack, items: FwItem[]): Promise<FwResolve | null> {
  if (!items.length) return { testing: false, mods: [] }
  const channels = packChannels(modpack.id)
  const reqMods = items.map(fi => ({
    id: fi.item.famworks_id as string,
    channel: channels[fi.item.famworks_id as string] || undefined,
    version: fi.item.famworks_version || undefined
  }))
  const key = `${modpack.id}|${modpack.mc_version}|${modpack.loader}|${JSON.stringify(reqMods)}`
  const cached = fwResolveCache.get(key)
  if (cached && Date.now() - cached.at < 60000) return cached.data
  try {
    const data = await resolveFamworks(modpack.mc_version, modpack.loader, reqMods)
    fwResolveCache.set(key, { at: Date.now(), data })
    return data
  } catch {
    return null // портал недоступен — зовущий решает, что делать
  }
}

/** Ставит/обновляет famworks-моды: качает актуальную версию и удаляет прежний файл при смене имени. */
async function installFamworks(modpack: Modpack, gameRoot: string, win: BrowserWindow): Promise<void> {
  const items = collectFamworksItems(modpack, gameRoot)
  if (!items.length) return
  emit(win, { phase: 'check', message: 'Проверка модов FamWorks...' })
  const resolved = await resolveForPack(modpack, items)
  if (!resolved) {
    win.webContents.send('launch:log', { id: modpack.id, text: '[famworks] портал недоступен — моды FamWorks не проверены, оставляю что стоит' })
    return
  }
  const byId = new Map(resolved.mods.map(e => [e.id, e]))
  const tracking = readFwTracking(gameRoot)
  let done = 0
  for (const fi of items) {
    if (isCancelled()) throw new DOMException('Aborted', 'AbortError')
    const fwid = fi.item.famworks_id as string
    const entry = byId.get(fwid)
    if (!entry || entry.status !== 'ok' || !entry.version) {
      if (entry?.status === 'not_found') win.webContents.send('launch:log', { id: modpack.id, text: `[famworks] «${fi.item.name}» не найден на портале` })
      else if (entry?.status === 'no_compatible') win.webContents.send('launch:log', { id: modpack.id, text: `[famworks] «${fi.item.name}»: нет версии под ${modpack.mc_version}/${modpack.loader}` })
      done++
      continue
    }
    const file = entry.version.files.find(f => f.primary) ?? entry.version.files[0]
    const sha = file?.hashes?.sha512
    if (!file?.url || !sha) { done++; continue }
    mkdirSync(fi.dir, { recursive: true })
    const tracked = tracking[fwid]
    // Уже стоит нужная версия (по sha512 + файл на месте)?
    if (tracked?.sha512 === sha && (existsSync(join(fi.dir, tracked.filename)) || existsSync(join(fi.dir, tracked.filename + '.disabled')))) {
      done++; continue
    }
    // Был ли мод выключен — новую версию ставим тоже выключенной.
    const wasDisabled = !!tracked && existsSync(join(fi.dir, tracked.filename + '.disabled')) && !existsSync(join(fi.dir, tracked.filename))
    const enabledPath = join(fi.dir, file.filename)
    await downloadWithProgress(file.url, enabledPath, (bytes, total, speed) => {
      emit(win, { phase: 'download', message: `Загрузка ${fi.item.name}`, current: done, total: items.length, bytesDownloaded: bytes, bytesTotal: total, speedBps: speed })
    }, sha)
    if (wasDisabled) { try { renameSync(enabledPath, enabledPath + '.disabled') } catch { /* перезапишется */ } }
    // Удаляем прежний файл этого мода при смене имени (и .jar, и .jar.disabled).
    if (tracked && tracked.filename !== file.filename) {
      try { unlinkSync(join(fi.dir, tracked.filename)) } catch {}
      try { unlinkSync(join(fi.dir, tracked.filename + '.disabled')) } catch {}
    }
    tracking[fwid] = { filename: file.filename, sha512: sha }
    done++
  }
  writeFwTracking(gameRoot, tracking)
}

/** Нужно ли обновление famworks-модов (для статуса сборки). Портал недоступен → не считаем устаревшим. */
async function famworksOutdated(modpack: Modpack, gameRoot: string): Promise<boolean> {
  const items = collectFamworksItems(modpack, gameRoot)
  if (!items.length) return false
  const resolved = await resolveForPack(modpack, items)
  if (!resolved) return false
  const byId = new Map(resolved.mods.map(e => [e.id, e]))
  const tracking = readFwTracking(gameRoot)
  for (const fi of items) {
    const fwid = fi.item.famworks_id as string
    const entry = byId.get(fwid)
    if (!entry || entry.status !== 'ok' || !entry.version) continue // не можем обновить — не блокируем
    const file = entry.version.files.find(f => f.primary) ?? entry.version.files[0]
    const sha = file?.hashes?.sha512
    if (!sha) continue
    const tracked = tracking[fwid]
    if (!tracked) { if (fi.item.required) return true; continue } // обязательный ещё не стоит
    if (tracked.sha512 !== sha) return true // стоит старая версия
  }
  return false
}

/** Реальные установленные файлы famworks-модов сборки (famworks_id → {filename, sha512}).
 *  Нужно списку модов: имя файла берётся с портала, а не из JSON сборки. */
export function getFamworksTracking(installPath: string, modpackId: string): Record<string, FwTrack> {
  return readFwTracking(join(installPath, modpackId))
}

/** Переустановить famworks-моды сборки под свежий канал (после переключения test/release). */
export async function reinstallFamworks(modpack: Modpack, installPath: string, win: BrowserWindow): Promise<void> {
  for (const k of [...fwResolveCache.keys()]) if (k.startsWith(modpack.id + '|')) fwResolveCache.delete(k)
  await installFamworks(modpack, join(installPath, modpack.id), win)
  emit(win, { phase: 'done', message: '' })
}

// ───────────────────────── Моды из манифеста сборки: прежние версии ─────────────────────────
// Манифест задаёт мод именем файла. Сменилась версия → имя другое → старый файл надо убрать,
// иначе в mods лежат две версии (Fabric молча берёт новейшую, Forge/NeoForge не запускается).

function manifestTrackPath(gameRoot: string): string { return join(gameRoot, '.famworks-manifest.json') }
/** Какой файл установщик поставил под каждый мод манифеста: mod.id → filename. */
function readManifestTracking(gameRoot: string): Record<string, string> {
  try { return JSON.parse(readFileSync(manifestTrackPath(gameRoot), 'utf8')).mods ?? {} } catch { return {} }
}
function writeManifestTracking(gameRoot: string, mods: Record<string, string>): void {
  try { writeFileSync(manifestTrackPath(gameRoot), JSON.stringify({ mods }, null, 2)) } catch { /* не критично */ }
}

/** Файлы в mods, которыми управляет лаунчер (манифест сборки + моды FamWorks) - в нижнем регистре. */
export function managedModFiles(gameRoot: string): Set<string> {
  return new Set([
    ...Object.values(readManifestTracking(gameRoot)),
    ...Object.values(readFwTracking(gameRoot)).map(t => t.filename)
  ].map(fileKey))
}

/** Файлы, принадлежащие позициям сборки - «прежней версией» другого мода их считать нельзя. */
function claimedFiles(modpack: Modpack, gameRoot: string): Set<string> {
  return new Set([
    ...modpack.mods.map(m => m.filename),
    ...Object.values(readFwTracking(gameRoot)).map(t => t.filename)
  ].map(fileKey))
}

/**
 * Оставшиеся в папке файлы прежней версии мода из манифеста.
 * tracked - что установщик ставил под этот мод раньше; undefined - трекинга ещё нет (ставил старый лаунчер),
 * тогда прежнюю версию узнаём по имени файла без версии.
 * fresh - новая версия только что скачана (а не стояла раньше).
 */
function previousVersions(
  mod: Mod, files: string[], tracked: string | undefined, claimed: Set<string>, fresh: boolean
): string[] {
  if (tracked !== undefined) {
    if (fileKey(tracked) === fileKey(mod.filename) || claimed.has(fileKey(tracked))) return []
    return files.filter(f => fileKey(f) === fileKey(tracked))
  }
  return otherVersions(files, mod.filename).filter(f =>
    !claimed.has(fileKey(f))
    // Выключенный файл рядом с уже стоящей версией не трогаем - его мог оставить игрок.
    && (fresh || !/\.disabled$/i.test(f))
  )
}

function listDir(dir: string): string[] {
  try { return readdirSync(dir) } catch { return [] }
}

/** Есть ли в mods прежние версии модов сборки, которые уберёт «Обновить». */
function hasStaleModVersions(modpack: Modpack, gameRoot: string): boolean {
  const modsDir = join(gameRoot, 'mods')
  const files = listDir(modsDir)
  const present = new Set(files.map(fileKey))
  const tracking = readManifestTracking(gameRoot)
  const claimed = claimedFiles(modpack, gameRoot)
  return modpack.mods.some(mod =>
    !mod.famworks_id && present.has(fileKey(mod.filename))
    && previousVersions(mod, files, tracking[mod.id], claimed, false).length > 0
  )
}

/** Убирает прежние версии модов манифеста и запоминает, какой файл стоит под каждым модом. */
function cleanupPreviousVersions(modpack: Modpack, gameRoot: string, downloaded: Set<Mod>): void {
  const modsDir = join(gameRoot, 'mods')
  const tracking = readManifestTracking(gameRoot)
  const claimed = claimedFiles(modpack, gameRoot)
  const next: Record<string, string> = {}
  for (const mod of modpack.mods) {
    if (mod.famworks_id) continue
    const enabled = join(modsDir, mod.filename)
    const disabled = enabled + '.disabled'
    if (!existsSync(enabled) && !existsSync(disabled)) {
      // Новая версия не скачалась (нет URL) - прежнюю не трогаем и помним её дальше.
      if (tracking[mod.id]) next[mod.id] = tracking[mod.id]
      continue
    }
    const fresh = downloaded.has(mod)
    const old = previousVersions(mod, listDir(modsDir), tracking[mod.id], claimed, fresh)
    // Прежняя версия была выключена - новую ставим тоже выключенной.
    if (fresh && old.length && old.every(f => /\.disabled$/i.test(f))) {
      try { renameSync(enabled, disabled) } catch { /* останется включённой */ }
    }
    for (const f of old) {
      try { unlinkSync(join(modsDir, f)) } catch { /* файл занят игрой - уберём в следующий раз */ }
    }
    next[mod.id] = mod.filename
  }
  writeManifestTracking(gameRoot, next)
}

export async function checkAndInstallModpack(
  modpack: Modpack,
  installPath: string,
  win: BrowserWindow
): Promise<void> {
  const gameRoot = join(installPath, modpack.id)
  const modsDir = join(gameRoot, 'mods')
  mkdirSync(modsDir, { recursive: true })

  emit(win, { phase: 'check', message: 'Проверка модов...' })

  // Удаляем устаревшие версии Fabric API (оставляем только нужную) — иначе две версии = краш
  if ((modpack.loader === 'fabric' || modpack.loader === 'quilt') && modpack.fabric_api_version) {
    const target = `fabric-api-${modpack.fabric_api_version}.jar`
    for (const f of readdirSync(modsDir)) {
      const base = f.replace(/\.disabled$/, '')
      if (/^fabric-api-.*\.jar$/i.test(base) && base !== target) {
        try { unlinkSync(join(modsDir, f)) } catch {}
      }
    }
  }

  const missing: Mod[] = []
  for (const mod of modpack.mods) {
    if (mod.famworks_id) continue // famworks-моды ставятся отдельно (installFamworks)
    const enabled = join(modsDir, mod.filename)
    const disabled = join(modsDir, mod.filename + '.disabled')
    if (!existsSync(enabled) && !existsSync(disabled)) {
      missing.push(mod)
    }
  }

  let done = 0
  const downloaded = new Set<Mod>()
  for (const mod of missing) {
    if (isCancelled()) throw new DOMException('Aborted', 'AbortError')
    const resolved = await resolveModUrl(mod, modpack.mc_version, modpack.loader)
    if (!resolved) {
      emit(win, { phase: 'download', message: `Пропуск ${mod.name} - нет URL`, current: done, total: missing.length })
      done++
      continue
    }
    await downloadWithProgress(resolved.url, join(modsDir, mod.filename), (bytes, total, speed) => {
      emit(win, {
        phase: 'download',
        message: `Загрузка ${mod.name}`,
        current: done,
        total: missing.length,
        bytesDownloaded: bytes,
        bytesTotal: total,
        speedBps: speed
      })
    }, resolved.sha512, resolved.sha1)
    downloaded.add(mod)
    done++
  }

  // Новые версии на месте - убираем прежние (и переносим на новую состояние «выключен»)
  cleanupPreviousVersions(modpack, gameRoot, downloaded)

  // Ресурспаки и шейдеры (та же механика — папка + .disabled). famworks_id — отдельно.
  await installPacks((modpack.resourcepacks ?? []).filter(p => !p.famworks_id), join(gameRoot, 'resourcepacks'), 'Ресурспак', modpack, win)
  await installPacks((modpack.shaders ?? []).filter(p => !p.famworks_id), join(gameRoot, 'shaderpacks'), 'Шейдер', modpack, win)

  // Моды/паки/шейдеры с портала FamWorks (ставим актуальную версию, удаляем старый файл при обновлении)
  await installFamworks(modpack, gameRoot, win)

  // Конфиги
  await installConfigs(modpack, gameRoot, win)

  emit(win, { phase: 'done', message: '' })
}

async function installPacks(packs: Mod[], dir: string, label: string, modpack: Modpack, win: BrowserWindow): Promise<void> {
  if (!packs.length) return
  mkdirSync(dir, { recursive: true })
  const missing = packs.filter(p => !existsSync(join(dir, p.filename)) && !existsSync(join(dir, p.filename + '.disabled')))
  let done = 0
  for (const p of missing) {
    if (isCancelled()) throw new DOMException('Aborted', 'AbortError')
    const resolved = await resolveModUrl(p, modpack.mc_version, modpack.loader)
    if (!resolved) { done++; continue }
    await downloadWithProgress(resolved.url, join(dir, p.filename), (bytes, total, speed) => {
      emit(win, { phase: 'download', message: `${label} ${p.name}`, current: done, total: missing.length, bytesDownloaded: bytes, bytesTotal: total, speedBps: speed })
    }, resolved.sha512, resolved.sha1)
    done++
  }
}

/** Безопасно строит путь назначения внутри gameRoot (защита от ../). */
function safeJoin(root: string, rel: string): string | null {
  const base = resolve(root)
  const dest = resolve(root, rel)
  if (dest !== base && !dest.startsWith(base + sep)) return null
  return dest
}

/** Маркер «архив уже распакован» — по хэшу содержимого (sha512), иначе по URL/пути.
 *  Смена содержимого архива → другой маркер → распаковка заново (учёт обновлений). */
function extractMarkerPath(gameRoot: string, cfg: ConfigFile): string {
  const id = createHash('sha1').update(cfg.sha512 || cfg.download_url || cfg.path).digest('hex')
  return join(gameRoot, '.fwextracted', id)
}

/** Скачивает zip-конфиг и распаковывает его в корень сборки (структура папок сохраняется),
 *  затем удаляет архив. Защита от zip-slip. Уважает overwrite. */
async function extractConfig(cfg: ConfigFile, gameRoot: string, done: number, total: number, win: BrowserWindow): Promise<void> {
  const marker = extractMarkerPath(gameRoot, cfg)
  if (existsSync(marker) && !cfg.overwrite) return // уже распаковано, содержимое не менялось

  const tmpZip = join(gameRoot, `.fwextract-${Date.now()}.zip`)
  try {
    await downloadWithProgress(cfg.download_url, tmpZip, (bytes, bTotal, speed) => {
      emit(win, { phase: 'download', message: `Распаковка ${cfg.path || 'архива'}`, current: done, total, bytesDownloaded: bytes, bytesTotal: bTotal, speedBps: speed })
    }, cfg.sha512)

    const zip = new AdmZip(tmpZip)
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue
      const outPath = safeJoin(gameRoot, e.entryName) // entryName хранит путь внутри архива → структура сохраняется
      if (!outPath) continue // выход за пределы (zip-slip) — пропускаем
      if (existsSync(outPath) && !cfg.overwrite) continue // не перетираем пользовательские файлы без overwrite
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, e.getData())
    }
    mkdirSync(dirname(marker), { recursive: true })
    writeFileSync(marker, new Date().toISOString())
  } finally {
    try { unlinkSync(tmpZip) } catch { /* уже нет */ }
  }
}

async function installConfigs(modpack: Modpack, gameRoot: string, win: BrowserWindow): Promise<void> {
  const configs = modpack.configs ?? []
  if (configs.length === 0) return

  let done = 0
  for (const cfg of configs) {
    if (isCancelled()) throw new DOMException('Aborted', 'AbortError')

    // Архив с распаковкой в корень
    if (cfg.extract) {
      await extractConfig(cfg, gameRoot, done, configs.length, win)
      done++
      continue
    }

    const dest = safeJoin(gameRoot, cfg.path)
    if (!dest) {
      emit(win, { phase: 'download', message: `Пропуск конфига ${cfg.path} - недопустимый путь` })
      done++
      continue
    }
    const exists = existsSync(dest)
    // overwrite=false и файл есть → не трогаем (пользовательские настройки сохраняются)
    if (exists && !cfg.overwrite) { done++; continue }

    mkdirSync(dirname(dest), { recursive: true })
    await downloadWithProgress(cfg.download_url, dest, (bytes, total, speed) => {
      emit(win, {
        phase: 'download',
        message: `Конфиг ${cfg.path}`,
        current: done,
        total: configs.length,
        bytesDownloaded: bytes,
        bytesTotal: total,
        speedBps: speed
      })
    }, cfg.sha512)
    done++
  }
}

export async function getModpackStatus(
  modpack: Modpack,
  installPath: string
): Promise<'not_installed' | 'outdated' | 'ready'> {
  const gameRoot = join(installPath, modpack.id)

  // Если загрузчик ещё не подготовлен (профиль Fabric/Quilt или installer Forge/NeoForge) — не установлена
  if (!loaderInstalled(modpack, gameRoot)) return 'not_installed'

  // Если нет всех обязательных модов — нужно обновление (famworks — отдельной проверкой ниже)
  const modsDir = join(gameRoot, 'mods')
  for (const mod of modpack.mods) {
    if (!mod.required || mod.famworks_id) continue
    const enabled = join(modsDir, mod.filename)
    const disabled = join(modsDir, mod.filename + '.disabled')
    if (!existsSync(enabled) && !existsSync(disabled)) {
      return 'outdated'
    }
  }

  // Остались прежние версии модов сборки (две версии одного мода) - «Обновить» их уберёт
  if (hasStaleModVersions(modpack, gameRoot)) return 'outdated'

  // Если какой-то конфиг сборки ещё не установлен — нужно обновление
  for (const cfg of modpack.configs ?? []) {
    if (cfg.extract) {
      if (!existsSync(extractMarkerPath(gameRoot, cfg))) return 'outdated'
      continue
    }
    const dest = safeJoin(gameRoot, cfg.path)
    if (dest && !existsSync(dest)) return 'outdated'
  }

  // Если обязательный ресурспак/шейдер ещё не скачан — нужно обновление (famworks — ниже)
  const missingPack = (list: Mod[], folder: string) => {
    const d = join(gameRoot, folder)
    return (list ?? []).some(p => p.required && !p.famworks_id && !existsSync(join(d, p.filename)) && !existsSync(join(d, p.filename + '.disabled')))
  }
  if (missingPack(modpack.resourcepacks ?? [], 'resourcepacks')) return 'outdated'
  if (missingPack(modpack.shaders ?? [], 'shaderpacks')) return 'outdated'

  // Моды FamWorks: вышла новая версия (или обязательный ещё не стоит) → нужно обновление.
  if (await famworksOutdated(modpack, gameRoot)) return 'outdated'

  return 'ready'
}

async function resolveModUrl(mod: Mod, mcVersion: string, loader: string): Promise<ResolvedMod | null> {
  // Прямая ссылка (кастом / CurseForge) — хэш берём из JSON (если указан)
  if (mod.download_url) return { url: mod.download_url, sha512: mod.sha512, sha1: mod.sha1 }

  if (mod.modrinth_id) {
    try {
      // Если версия запинена — ищем без фильтра по mc (версия сама задаёт совместимость),
      // иначе берём последнюю совместимую с mc/loader.
      const params = mod.modrinth_version_number
        ? { loaders: JSON.stringify([loader]) }
        : { game_versions: JSON.stringify([mcVersion]), loaders: JSON.stringify([loader]) }
      const res = await axios.get(
        `https://api.modrinth.com/v2/project/${mod.modrinth_id}/version`,
        { headers: { 'User-Agent': 'famworks-launcher/1.0' }, params, signal: opSignal() }
      )
      type V = { version_number: string; files: { url: string; primary: boolean; hashes?: { sha512?: string } }[] }
      const versions: V[] = res.data
      if (!versions.length) return null
      const chosen = mod.modrinth_version_number
        ? versions.find(v => v.version_number === mod.modrinth_version_number)
        : versions[0]
      if (!chosen) return null
      const file = chosen.files.find(f => f.primary) ?? chosen.files[0]
      if (!file?.url) return null
      // Modrinth отдаёт sha512 в hex — проверяем бесплатно
      return { url: file.url, sha512: mod.sha512 ?? file.hashes?.sha512 }
    } catch { return null }
  }
  return null
}

async function downloadWithProgress(
  url: string,
  dest: string,
  onProgress: (bytes: number, total: number, speed: number) => void,
  expectedSha512?: string,
  expectedSha1?: string
) {
  const tmp = dest + '.tmp'
  const signal = opSignal()
  const res = await axios.get(url, { responseType: 'stream', signal })
  const total = parseInt(String(res.headers['content-length'] ?? '0'), 10)

  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(tmp)
    let downloaded = 0
    let lastTime = Date.now()
    let lastBytes = 0
    let settled = false

    const fail = (e: unknown) => {
      if (settled) return
      settled = true
      try { res.data.destroy() } catch {}
      try { stream.destroy() } catch {}
      try { unlinkSync(tmp) } catch {}
      reject(e)
    }
    // Явная реакция на отмену — иначе поток может «повиснуть» без error/finish
    const onAbort = () => fail(new DOMException('Aborted', 'AbortError'))
    if (signal) {
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
    }

    res.data.on('data', (chunk: Buffer) => {
      downloaded += chunk.length
      const now = Date.now()
      const elapsed = (now - lastTime) / 1000
      if (elapsed >= 0.3) {
        const speed = (downloaded - lastBytes) / elapsed
        lastTime = now
        lastBytes = downloaded
        onProgress(downloaded, total, speed)
      }
    })

    res.data.pipe(stream)
    stream.on('finish', () => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      resolve()
    })
    stream.on('error', fail)
    res.data.on('error', fail)
    res.data.on('aborted', () => fail(new DOMException('Aborted', 'AbortError')))
  })

  // Проверка целостности: sha512 (Modrinth/кастом) либо sha1 (CurseForge)
  const check = expectedSha512 ? { algo: 'sha512' as const, val: expectedSha512 }
    : expectedSha1 ? { algo: 'sha1' as const, val: expectedSha1 } : null
  if (check) {
    const actual = await hashFile(tmp, check.algo)
    if (actual.toLowerCase() !== check.val.toLowerCase()) {
      try { unlinkSync(tmp) } catch {}
      throw new Error(`Контрольная сумма не совпала: ${dest.split(/[\\/]/).pop()}`)
    }
  }

  renameSync(tmp, dest)
}

export async function downloadModToDir(url: string, filename: string, modsDir: string, win?: BrowserWindow, sha512?: string, sha1?: string) {
  mkdirSync(modsDir, { recursive: true })
  if (win) emit(win, { phase: 'download', message: `Загрузка ${filename}`, current: 0, total: 1, bytesDownloaded: 0, bytesTotal: 0, speedBps: 0 })
  await downloadWithProgress(url, join(modsDir, filename), (bytes, total, speed) => {
    if (win) emit(win, { phase: 'download', message: `Загрузка ${filename}`, current: 0, total: 1, bytesDownloaded: bytes, bytesTotal: total, speedBps: speed })
  }, sha512, sha1)
  if (win) emit(win, { phase: 'done', message: '' })
}

export function toggleMod(modsDir: string, filename: string, enabled: boolean) {
  const enabledPath = join(modsDir, filename)
  const disabledPath = join(modsDir, filename + '.disabled')
  if (enabled && existsSync(disabledPath)) renameSync(disabledPath, enabledPath)
  else if (!enabled && existsSync(enabledPath)) renameSync(enabledPath, disabledPath)
}

export function deleteMod(modsDir: string, filename: string) {
  const enabledPath = join(modsDir, filename)
  const disabledPath = join(modsDir, filename + '.disabled')
  if (existsSync(enabledPath)) unlinkSync(enabledPath)
  if (existsSync(disabledPath)) unlinkSync(disabledPath)
}

export function getInstalledMods(modsDir: string): string[] {
  if (!existsSync(modsDir)) return []
  return readdirSync(modsDir)
}

export function getModFileSizeBytes(modsDir: string, filename: string): number {
  const paths = [join(modsDir, filename), join(modsDir, filename + '.disabled')]
  for (const p of paths) {
    try { return statSync(p).size } catch {}
  }
  return 0
}
