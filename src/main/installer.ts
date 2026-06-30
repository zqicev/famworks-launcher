import { join, dirname, resolve, sep } from 'path'
import { createWriteStream, createReadStream, existsSync, mkdirSync, renameSync, unlinkSync, readdirSync, statSync } from 'fs'
import { createHash } from 'crypto'
import axios from 'axios'
import { BrowserWindow } from 'electron'
import { Modpack, Mod } from '../types/modpack'
import { opSignal, isCancelled } from './abort'

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
  if (modpack.loader === 'fabric' && modpack.fabric_api_version) {
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
    const enabled = join(modsDir, mod.filename)
    const disabled = join(modsDir, mod.filename + '.disabled')
    if (!existsSync(enabled) && !existsSync(disabled)) {
      missing.push(mod)
    }
  }

  let done = 0
  for (const mod of missing) {
    if (isCancelled()) throw new DOMException('Aborted', 'AbortError')
    const resolved = await resolveModUrl(mod, modpack.mc_version, modpack.loader)
    if (!resolved) {
      emit(win, { phase: 'download', message: `Пропуск ${mod.name} — нет URL`, current: done, total: missing.length })
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
    done++
  }

  // Ресурспаки и шейдеры (та же механика — папка + .disabled)
  await installPacks(modpack.resourcepacks ?? [], join(gameRoot, 'resourcepacks'), 'Ресурспак', modpack, win)
  await installPacks(modpack.shaders ?? [], join(gameRoot, 'shaderpacks'), 'Шейдер', modpack, win)

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

async function installConfigs(modpack: Modpack, gameRoot: string, win: BrowserWindow): Promise<void> {
  const configs = modpack.configs ?? []
  if (configs.length === 0) return

  let done = 0
  for (const cfg of configs) {
    if (isCancelled()) throw new DOMException('Aborted', 'AbortError')
    const dest = safeJoin(gameRoot, cfg.path)
    if (!dest) {
      emit(win, { phase: 'download', message: `Пропуск конфига ${cfg.path} — недопустимый путь` })
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
  const versionId = `fabric-loader-${modpack.loader_version}-${modpack.mc_version}`
  const versionFile = join(gameRoot, 'versions', versionId, `${versionId}.json`)

  // Если нет даже Fabric-профиля — не установлена
  if (!existsSync(versionFile)) return 'not_installed'

  // Если нет всех обязательных модов — нужно обновление
  const modsDir = join(gameRoot, 'mods')
  for (const mod of modpack.mods) {
    if (!mod.required) continue
    const enabled = join(modsDir, mod.filename)
    const disabled = join(modsDir, mod.filename + '.disabled')
    if (!existsSync(enabled) && !existsSync(disabled)) {
      return 'outdated'
    }
  }

  // Если какой-то конфиг сборки ещё не установлен — нужно обновление
  for (const cfg of modpack.configs ?? []) {
    const dest = safeJoin(gameRoot, cfg.path)
    if (dest && !existsSync(dest)) return 'outdated'
  }

  // Если обязательный ресурспак/шейдер ещё не скачан — нужно обновление
  const missingPack = (list: Mod[], folder: string) => {
    const d = join(gameRoot, folder)
    return (list ?? []).some(p => p.required && !existsSync(join(d, p.filename)) && !existsSync(join(d, p.filename + '.disabled')))
  }
  if (missingPack(modpack.resourcepacks ?? [], 'resourcepacks')) return 'outdated'
  if (missingPack(modpack.shaders ?? [], 'shaderpacks')) return 'outdated'

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
  const res = await axios.get(url, { responseType: 'stream', signal: opSignal() })
  const total = parseInt(String(res.headers['content-length'] ?? '0'), 10)

  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(tmp)
    let downloaded = 0
    let lastTime = Date.now()
    let lastBytes = 0

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
    stream.on('finish', resolve)
    stream.on('error', (e) => { try { unlinkSync(tmp) } catch {} reject(e) })
    res.data.on('error', (e: Error) => { try { unlinkSync(tmp) } catch {} reject(e) })
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

export async function downloadModToDir(url: string, filename: string, modsDir: string, win?: BrowserWindow, sha512?: string) {
  mkdirSync(modsDir, { recursive: true })
  if (win) emit(win, { phase: 'download', message: `Загрузка ${filename}`, current: 0, total: 1, bytesDownloaded: 0, bytesTotal: 0, speedBps: 0 })
  await downloadWithProgress(url, join(modsDir, filename), (bytes, total, speed) => {
    if (win) emit(win, { phase: 'download', message: `Загрузка ${filename}`, current: 0, total: 1, bytesDownloaded: bytes, bytesTotal: total, speedBps: speed })
  }, sha512)
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
