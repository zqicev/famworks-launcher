import { join, dirname } from 'path'
import { existsSync, mkdirSync, writeFileSync, createWriteStream, rmSync } from 'fs'
import axios from 'axios'
import { BrowserWindow } from 'electron'
import type { ProgressEvent } from './installer'
import { Modpack } from '../types/modpack'
import { opSignal } from './abort'

export type LoaderId = 'fabric' | 'quilt' | 'forge' | 'neoforge'

/** Как запускать сборку после подготовки загрузчика:
 *  - custom: vanilla-style version json (Fabric/Quilt) → options.version.custom
 *  - forge:  installer-jar (Forge/NeoForge) → options.forge (mclc сам прогонит процессоры) */
export type LoaderSetup =
  | { kind: 'custom'; versionId: string }
  | { kind: 'forge'; installerPath: string }

const LABELS: Record<LoaderId, string> = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' }

function emit(win: BrowserWindow, e: ProgressEvent): void {
  win.webContents.send('install:progress', e)
}

/** Требуемая мажорная версия Java по версии Minecraft (одинакова для всех загрузчиков). */
export function requiredJavaMajor(mc: string): number {
  const parts = mc.split('.').map(n => parseInt(n, 10))
  const minor = parts[1] || 0
  const patch = parts[2] || 0
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21 // 1.20.5+ и 1.21+
  if (minor >= 17) return 17 // 1.17–1.20.4
  return 8 // 1.16.5 и старше
}

/** Vanilla-style version id для Fabric/Quilt (папка versions/<id>/<id>.json). */
function customVersionId(modpack: Modpack): string | null {
  const { loader, mc_version: mc, loader_version: lv } = modpack
  if (loader === 'fabric') return `fabric-loader-${lv}-${mc}`
  if (loader === 'quilt') return `quilt-loader-${lv}-${mc}`
  return null
}

/** Путь к кэшированному installer-jar для Forge/NeoForge. */
function installerPath(gameRoot: string, modpack: Modpack): string {
  return join(gameRoot, '.loader', `${modpack.loader}-${modpack.loader_version}-installer.jar`)
}

/** Установлен ли загрузчик (для определения статуса сборки без запуска). */
export function loaderInstalled(modpack: Modpack, gameRoot: string): boolean {
  const id = customVersionId(modpack)
  if (id) return existsSync(join(gameRoot, 'versions', id, `${id}.json`))
  return existsSync(installerPath(gameRoot, modpack))
}

/** Готовит загрузчик: скачивает профиль (Fabric/Quilt) или installer (Forge/NeoForge). */
export async function setupLoader(modpack: Modpack, gameRoot: string, win: BrowserWindow): Promise<LoaderSetup> {
  const loader = modpack.loader as LoaderId
  const { mc_version: mc, loader_version: lv } = modpack

  // Fabric / Quilt — забираем готовый vanilla-style профиль из meta-API
  const id = customVersionId(modpack)
  if (id) {
    const versionDir = join(gameRoot, 'versions', id)
    const versionFile = join(versionDir, `${id}.json`)
    if (!existsSync(versionFile)) {
      emit(win, { phase: 'download', message: `Загрузка ${LABELS[loader]}...` })
      const url = loader === 'fabric'
        ? `https://meta.fabricmc.net/v2/versions/loader/${mc}/${lv}/profile/json`
        : `https://meta.quiltmc.org/v3/versions/loader/${mc}/${lv}/profile/json`
      const res = await axios.get(url, { timeout: 15000, signal: opSignal() })
      mkdirSync(versionDir, { recursive: true })
      writeFileSync(versionFile, JSON.stringify(res.data, null, 2))
    }
    return { kind: 'custom', versionId: id }
  }

  // Forge / NeoForge — скачиваем официальный installer, процессоры прогонит mclc при запуске
  const dest = installerPath(gameRoot, modpack)
  if (!existsSync(dest)) {
    emit(win, { phase: 'download', message: `Загрузка установщика ${LABELS[loader]}...` })
    const url = loader === 'forge'
      ? `https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${lv}/forge-${mc}-${lv}-installer.jar`
      : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${lv}/neoforge-${lv}-installer.jar`
    mkdirSync(dirname(dest), { recursive: true })
    await downloadFile(url, dest)
  }
  return { kind: 'forge', installerPath: dest }
}

/** Последняя версия загрузчика под данную версию MC (для создания сборки). '' если не нашли. */
export async function latestLoaderVersion(loader: LoaderId, mc: string): Promise<string> {
  try {
    if (loader === 'fabric') {
      const { data } = await axios.get(`https://meta.fabricmc.net/v2/versions/loader/${mc}`, { timeout: 8000 })
      const stable = (data as any[]).find(v => v.loader?.stable) ?? (data as any[])[0]
      return stable?.loader?.version ?? ''
    }
    if (loader === 'quilt') {
      const { data } = await axios.get(`https://meta.quiltmc.org/v3/versions/loader/${mc}`, { timeout: 8000 })
      const stable = (data as any[]).find(v => !/beta|pre|rc/i.test(v.loader?.version ?? '')) ?? (data as any[])[0]
      return stable?.loader?.version ?? ''
    }
    if (loader === 'forge') {
      const { data } = await axios.get('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', { timeout: 8000 })
      const promos = (data as any).promos ?? {}
      return promos[`${mc}-recommended`] ?? promos[`${mc}-latest`] ?? ''
    }
    // neoforge — фильтруем maven-metadata по префиксу версии MC (1.21.1 → 21.1.*)
    const { data } = await axios.get('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml', {
      timeout: 8000, responseType: 'text'
    })
    const p = mc.split('.')
    const prefix = `${p[1] ?? '0'}.${p[2] ?? '0'}`
    const versions = [...String(data).matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1])
    return versions.filter(v => v.startsWith(prefix + '.')).pop() ?? ''
  } catch {
    return ''
  }
}

/** Простая потоковая загрузка файла с поддержкой отмены. */
async function downloadFile(url: string, dest: string): Promise<void> {
  const tmp = dest + '.tmp'
  const signal = opSignal()
  const res = await axios.get(url, { responseType: 'stream', maxRedirects: 5, signal })
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(tmp)
    let settled = false
    const fail = (e: unknown): void => {
      if (settled) return
      settled = true
      try { res.data.destroy() } catch {}
      try { stream.destroy() } catch {}
      try { rmSync(tmp, { force: true }) } catch {}
      reject(e)
    }
    if (signal) {
      if (signal.aborted) return fail(new DOMException('Aborted', 'AbortError'))
      signal.addEventListener('abort', () => fail(new DOMException('Aborted', 'AbortError')), { once: true })
    }
    res.data.pipe(stream)
    stream.on('finish', () => { if (!settled) { settled = true; resolve() } })
    stream.on('error', fail)
    res.data.on('error', fail)
    res.data.on('aborted', () => fail(new DOMException('Aborted', 'AbortError')))
  })
  const { renameSync } = await import('fs')
  renameSync(tmp, dest)
}
