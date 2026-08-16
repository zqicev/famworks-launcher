import { join } from 'path'
import { existsSync, mkdirSync, createWriteStream, renameSync, writeFileSync } from 'fs'
import axios from 'axios'
import { BrowserWindow } from 'electron'
import type { ProgressEvent } from './installer'
import { opSignal, isCancelled } from './abort'

const RESOURCES = 'https://resources.download.minecraft.net'
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const CONCURRENCY = 24 // у mclc безлимитный Promise.all на 4000 файлов — мы качаем ограниченно

function emit(win: BrowserWindow, e: ProgressEvent): void { win.webContents.send('install:progress', e) }

async function getJson<T>(url: string): Promise<T> {
  const { data } = await axios.get<T>(url, { timeout: 15000, signal: opSignal() })
  return data
}

async function download(url: string, dest: string): Promise<void> {
  const tmp = dest + '.tmp'
  // Без signal: отмену ловим в цикле через isCancelled() (иначе тысячи запросов вешают
  // слушатели на один AbortSignal → MaxListenersExceededWarning). Файлы ассетов крошечные.
  const res = await axios.get(url, { responseType: 'stream', maxRedirects: 5, timeout: 30000 })
  await new Promise<void>((resolve, reject) => {
    const s = createWriteStream(tmp)
    res.data.pipe(s)
    s.on('finish', () => resolve())
    s.on('error', reject)
    res.data.on('error', reject)
  })
  renameSync(tmp, dest)
}

/**
 * Предзагрузка ванильных ассетов Minecraft в общий кэш (installPath/assets) до запуска mclc:
 * с ограниченной параллельностью и нормальным прогрессом. mclc потом найдёт их готовыми
 * и не будет качать сам (у него безлимитный параллелизм, из-за чего прогресс «стоит»).
 * Маркер .assets-<версия> помечает, что всё скачано — повторные запуски мгновенны.
 */
export async function ensureAssets(mcVersion: string, installPath: string, win: BrowserWindow): Promise<void> {
  const assetRoot = join(installPath, 'assets')
  const marker = join(assetRoot, `.assets-${mcVersion}`)
  if (existsSync(marker)) return

  let assetIndexUrl: string | undefined
  try {
    const manifest = await getJson<{ versions: { id: string; url: string }[] }>(MANIFEST)
    const entry = manifest.versions.find(v => v.id === mcVersion)
    if (!entry) return
    const ver = await getJson<{ assetIndex?: { url: string } }>(entry.url)
    assetIndexUrl = ver.assetIndex?.url
  } catch {
    return // нет метаданных — пусть mclc разбирается при запуске
  }
  if (isCancelled() || !assetIndexUrl) return

  let objects: Record<string, { hash: string }>
  try {
    const index = await getJson<{ objects: Record<string, { hash: string }> }>(assetIndexUrl)
    objects = index.objects || {}
  } catch {
    return
  }

  // Уникальные хэши (несколько имён могут указывать на один объект)
  const hashes = [...new Set(Object.values(objects).map(o => o.hash))]
  const missing = hashes.filter(h => !existsSync(join(assetRoot, 'objects', h.slice(0, 2), h)))
  if (missing.length === 0) {
    try { mkdirSync(assetRoot, { recursive: true }); writeFileSync(marker, '') } catch { /* noop */ }
    return
  }

  emit(win, { phase: 'download', message: 'Скачивание ресурсов Minecraft', current: 0, total: missing.length })
  let done = 0
  let failed = 0
  let idx = 0

  async function worker(): Promise<void> {
    while (idx < missing.length) {
      if (isCancelled()) throw new DOMException('Aborted', 'AbortError')
      const h = missing[idx++]
      const sub = h.slice(0, 2)
      const dir = join(assetRoot, 'objects', sub)
      const dest = join(dir, h)
      try {
        mkdirSync(dir, { recursive: true })
        await download(`${RESOURCES}/${sub}/${h}`, dest)
      } catch (e) {
        if (isCancelled()) throw e
        failed++ // отдельный ассет не скачался — не блокируем, mclc дотянет при запуске
      }
      done++
      if (done % 25 === 0 || done === missing.length) {
        emit(win, { phase: 'download', message: 'Скачивание ресурсов Minecraft', current: done, total: missing.length })
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  if (failed === 0) { try { writeFileSync(marker, new Date().toISOString()) } catch { /* noop */ } }
}
