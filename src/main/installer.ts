import { join } from 'path'
import { createWriteStream, createReadStream, existsSync, mkdirSync, renameSync, unlinkSync, readdirSync, statSync } from 'fs'
import { createHash } from 'crypto'
import axios from 'axios'
import { BrowserWindow } from 'electron'
import { Modpack, Mod } from '../types/modpack'
import { opSignal, isCancelled } from './abort'

interface ResolvedMod {
  url: string
  sha512?: string
}

/** Считает sha512 файла (hex) потоково, без загрузки целиком в память. */
function sha512File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
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
  const modsDir = join(installPath, modpack.id, 'mods')
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

  if (missing.length === 0) {
    emit(win, { phase: 'done', message: '' })
    return
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
    }, resolved.sha512)
    done++
  }

  emit(win, { phase: 'done', message: '' })
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

  return 'ready'
}

async function resolveModUrl(mod: Mod, mcVersion: string, loader: string): Promise<ResolvedMod | null> {
  // Кастомный jar по прямой ссылке — хэш берём из JSON (если указан)
  if (mod.download_url) return { url: mod.download_url, sha512: mod.sha512 }

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
  expectedSha512?: string
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

  // Проверка целостности по sha512 (hex, регистр не важен)
  if (expectedSha512) {
    const actual = await sha512File(tmp)
    if (actual.toLowerCase() !== expectedSha512.toLowerCase()) {
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
