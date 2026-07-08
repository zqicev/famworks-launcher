import { join, dirname } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, createWriteStream, rmSync, renameSync } from 'fs'
import { spawn } from 'child_process'
import axios from 'axios'
import { BrowserWindow } from 'electron'
import type { ProgressEvent } from './installer'
import { Modpack } from '../types/modpack'
import { ensureJava } from './java'
import { opSignal } from './abort'

export type LoaderId = 'fabric' | 'quilt' | 'forge' | 'neoforge'

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

/** Имя vanilla-style version-профиля (папка versions/<id>/<id>.json) для каждого загрузчика.
 *  Fabric/Quilt отдают его в meta-API; Forge/NeoForge создают такой же профиль установщиком. */
export function versionIdFor(mp: Modpack): string {
  const { loader, mc_version: mc, loader_version: lv } = mp
  switch (loader) {
    case 'quilt': return `quilt-loader-${lv}-${mc}`
    case 'forge': return `${mc}-forge-${lv}`
    case 'neoforge': return `neoforge-${lv}`
    default: return `fabric-loader-${lv}-${mc}`
  }
}

/** Установлен ли загрузчик — есть ли готовый version-профиль (для определения статуса без запуска). */
export function loaderInstalled(mp: Modpack, gameRoot: string): boolean {
  const id = versionIdFor(mp)
  return existsSync(join(gameRoot, 'versions', id, `${id}.json`))
}

/** JVM-аргументы загрузчика из профиля (module-path и пр. у Forge/NeoForge).
 *  mclc НЕ читает arguments.jvm из кастомного профиля, поэтому передаём их через options.customArgs.
 *  Для Fabric/Quilt пусто — им спец-аргументы не нужны. */
export function loaderJvmArgs(mp: Modpack, gameRoot: string): string[] {
  if (mp.loader !== 'forge' && mp.loader !== 'neoforge') return []
  const id = versionIdFor(mp)
  const jsonPath = join(gameRoot, 'versions', id, `${id}.json`)
  if (!existsSync(jsonPath)) return []
  let json: any
  try { json = JSON.parse(readFileSync(jsonPath, 'utf8')) } catch { return [] }
  const raw = json?.arguments?.jvm
  if (!Array.isArray(raw)) return []

  const libDir = join(gameRoot, 'libraries')
  const sep = process.platform === 'win32' ? ';' : ':'
  const versionName = json.inheritsFrom || mp.mc_version
  const subst = (s: string): string => s
    .split('${library_directory}').join(libDir)
    .split('${classpath_separator}').join(sep)
    .split('${version_name}').join(versionName)

  const out: string[] = []
  for (const a of raw) {
    // Условные объекты {rules,value} у jvm Forge/NeoForge практически не встречаются — берём строки
    if (typeof a === 'string') out.push(subst(a))
  }
  return out
}

/** Готовит загрузчик и возвращает id профиля для options.version.custom.
 *  Fabric/Quilt — тянет готовый профиль из meta-API.
 *  Forge/NeoForge — скачивает официальный установщик и прогоняет --installClient (создаёт профиль). */
export async function setupLoader(mp: Modpack, gameRoot: string, win: BrowserWindow): Promise<string> {
  const loader = mp.loader as LoaderId
  const id = versionIdFor(mp)
  const versionFile = join(gameRoot, 'versions', id, `${id}.json`)
  if (existsSync(versionFile)) return id

  if (loader === 'fabric' || loader === 'quilt') {
    emit(win, { phase: 'download', message: `Загрузка ${LABELS[loader]}...` })
    const url = loader === 'fabric'
      ? `https://meta.fabricmc.net/v2/versions/loader/${mp.mc_version}/${mp.loader_version}/profile/json`
      : `https://meta.quiltmc.org/v3/versions/loader/${mp.mc_version}/${mp.loader_version}/profile/json`
    const res = await axios.get(url, { timeout: 15000, signal: opSignal() })
    mkdirSync(dirname(versionFile), { recursive: true })
    writeFileSync(versionFile, JSON.stringify(res.data, null, 2))
    return id
  }

  // Forge / NeoForge — официальный установщик
  const installer = join(gameRoot, '.loader', `${loader}-${mp.loader_version}-installer.jar`)
  if (!existsSync(installer)) {
    emit(win, { phase: 'download', message: `Загрузка установщика ${LABELS[loader]}...` })
    const url = loader === 'forge'
      ? `https://maven.minecraftforge.net/net/minecraftforge/forge/${mp.mc_version}-${mp.loader_version}/forge-${mp.mc_version}-${mp.loader_version}-installer.jar`
      : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${mp.loader_version}/neoforge-${mp.loader_version}-installer.jar`
    mkdirSync(dirname(installer), { recursive: true })
    await downloadFile(url, installer)
  }

  emit(win, { phase: 'download', message: `Установка ${LABELS[loader]} (может занять минуту)...` })
  const javaPath = await ensureJava(dirname(gameRoot), win, requiredJavaMajor(mp.mc_version))
  await runClientInstaller(javaPath, installer, gameRoot, win)
  if (!existsSync(versionFile)) {
    throw new Error(`${LABELS[loader]}: установщик не создал профиль ${id}. Проверьте версию загрузчика (${mp.loader_version}).`)
  }
  return id
}

/** Прогоняет установщик Forge/NeoForge в headless-режиме (создаёт versions/<id>/<id>.json + библиотеки). */
async function runClientInstaller(javaPath: string, installer: string, gameRoot: string, win: BrowserWindow): Promise<void> {
  mkdirSync(gameRoot, { recursive: true })
  // Установщик требует наличия launcher_profiles.json в целевой папке
  const profiles = join(gameRoot, 'launcher_profiles.json')
  if (!existsSync(profiles)) {
    writeFileSync(profiles, JSON.stringify({ profiles: {}, selectedProfile: '', clientToken: 'famworks' }))
  }
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(javaPath, ['-jar', installer, '--installClient', gameRoot], { cwd: gameRoot })
    let tail = ''
    const onOut = (d: Buffer): void => {
      const s = d.toString()
      tail = (tail + s).slice(-800)
      win.webContents.send('launch:log', `[installer] ${s.trim()}`)
    }
    proc.stdout.on('data', onOut)
    proc.stderr.on('data', onOut)
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Установщик завершился с кодом ${code}: ${tail.slice(-300)}`))
    })
  })
}

/** Последняя версия выбранного загрузчика под данную версию MC (для создания сборки). '' если не нашли. */
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
  renameSync(tmp, dest)
}
