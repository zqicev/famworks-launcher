import { join } from 'path'
import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync, readdirSync } from 'fs'
import axios from 'axios'
import { BrowserWindow } from 'electron'
import { Modpack, Mod } from '../types/modpack'

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
    const url = await resolveModUrl(mod)
    if (!url) {
      emit(win, { phase: 'download', message: `Пропуск ${mod.name} — нет URL`, current: done, total: missing.length })
      done++
      continue
    }
    await downloadWithProgress(url, join(modsDir, mod.filename), (bytes, total, speed) => {
      emit(win, {
        phase: 'download',
        message: `Загрузка ${mod.name}`,
        current: done,
        total: missing.length,
        bytesDownloaded: bytes,
        bytesTotal: total,
        speedBps: speed
      })
    })
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

async function resolveModUrl(mod: Mod): Promise<string | null> {
  if (mod.download_url) return mod.download_url
  if (mod.modrinth_id) {
    try {
      const res = await axios.get(
        `https://api.modrinth.com/v2/version/${mod.modrinth_id}`,
        { headers: { 'User-Agent': 'famworks-launcher/1.0' } }
      )
      const file = res.data.files?.find((f: { primary: boolean }) => f.primary) ?? res.data.files?.[0]
      return file?.url ?? null
    } catch { return null }
  }
  return null
}

async function downloadWithProgress(
  url: string,
  dest: string,
  onProgress: (bytes: number, total: number, speed: number) => void
) {
  const tmp = dest + '.tmp'
  const res = await axios.get(url, { responseType: 'stream' })
  const total = parseInt(res.headers['content-length'] ?? '0', 10)

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
    stream.on('error', reject)
    res.data.on('error', reject)
  })

  renameSync(tmp, dest)
}

export async function downloadModToDir(url: string, filename: string, modsDir: string, win?: BrowserWindow) {
  mkdirSync(modsDir, { recursive: true })
  if (win) emit(win, { phase: 'download', message: `Загрузка ${filename}`, current: 0, total: 1, bytesDownloaded: 0, bytesTotal: 0, speedBps: 0 })
  await downloadWithProgress(url, join(modsDir, filename), (bytes, total, speed) => {
    if (win) emit(win, { phase: 'download', message: `Загрузка ${filename}`, current: 0, total: 1, bytesDownloaded: bytes, bytesTotal: total, speedBps: speed })
  })
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
