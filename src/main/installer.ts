import { join, basename } from 'path'
import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync, readdirSync } from 'fs'
import axios from 'axios'
import { BrowserWindow } from 'electron'
import { Modpack, Mod } from '../types/modpack'

export async function installModpack(
  modpack: Modpack,
  installPath: string,
  win: BrowserWindow
) {
  const gameRoot = join(installPath, modpack.id)
  const modsDir = join(gameRoot, 'mods')

  mkdirSync(modsDir, { recursive: true })

  const total = modpack.mods.length
  let done = 0

  for (const mod of modpack.mods) {
    const url = await resolveModUrl(mod)
    if (!url) {
      win.webContents.send('install:log', `Skipping ${mod.name} — no URL`)
      done++
      continue
    }

    const destPath = join(modsDir, mod.filename)
    if (!existsSync(destPath)) {
      win.webContents.send('install:log', `Downloading ${mod.name}...`)
      await downloadFile(url, destPath)
    }

    done++
    win.webContents.send('install:progress', { done, total, mod: mod.name })
  }
}

export async function resolveModUrl(mod: Mod): Promise<string | null> {
  if (mod.download_url) return mod.download_url

  if (mod.modrinth_id) {
    try {
      const res = await axios.get(
        `https://api.modrinth.com/v2/version/${mod.modrinth_id}`,
        { headers: { 'User-Agent': 'famworks-launcher/1.0' } }
      )
      const file = res.data.files?.find((f: { primary: boolean }) => f.primary) ?? res.data.files?.[0]
      return file?.url ?? null
    } catch {
      return null
    }
  }

  return null
}

export async function downloadModToDir(url: string, filename: string, modsDir: string) {
  mkdirSync(modsDir, { recursive: true })
  await downloadFile(url, join(modsDir, filename))
}

async function downloadFile(url: string, dest: string) {
  const tmp = dest + '.tmp'
  const res = await axios.get(url, { responseType: 'stream' })
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(tmp)
    res.data.pipe(stream)
    stream.on('finish', resolve)
    stream.on('error', reject)
  })
  renameSync(tmp, dest)
}

export function toggleMod(modsDir: string, filename: string, enabled: boolean) {
  const enabledPath = join(modsDir, filename)
  const disabledPath = join(modsDir, filename + '.disabled')

  if (enabled && existsSync(disabledPath)) {
    renameSync(disabledPath, enabledPath)
  } else if (!enabled && existsSync(enabledPath)) {
    renameSync(enabledPath, disabledPath)
  }
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
