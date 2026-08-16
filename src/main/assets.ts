import { join, dirname } from 'path'
import { existsSync, mkdirSync, createWriteStream, renameSync, writeFileSync, readFileSync } from 'fs'
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
    // axios timeout не покрывает передачу тела для stream — свой предохранитель от зависшего соединения
    const timer = setTimeout(() => { try { res.data.destroy() } catch { /* noop */ } try { s.destroy() } catch { /* noop */ } reject(new Error('body-timeout')) }, 30000)
    res.data.pipe(s)
    s.on('finish', () => { clearTimeout(timer); resolve() })
    s.on('error', (e: unknown) => { clearTimeout(timer); reject(e) })
    res.data.on('error', (e: unknown) => { clearTimeout(timer); reject(e) })
  })
  renameSync(tmp, dest)
}

/** Валиден ли уже лежащий файл asset-index (не битый/не усечённый). */
function indexValid(indexPath: string): boolean {
  try { JSON.parse(readFileSync(indexPath, 'utf8')); return true } catch { return false }
}

/**
 * Предзагрузка ванильных ассетов Minecraft в общий кэш (installPath/assets) до запуска mclc:
 * с ограниченной параллельностью и нормальным прогрессом. mclc потом найдёт их готовыми
 * и не будет качать сам (у него безлимитный параллелизм, из-за чего прогресс «стоит»).
 *
 * Также пишем валидный asset-index АТОМАРНО туда, где его читает mclc (indexes/<assetId>.json,
 * где assetId = version.custom загрузчика || версия MC). Это чинит битый/усечённый индекс,
 * оставшийся от прерванных запусков (иначе mclc падает: «Unterminated string in JSON»).
 * Маркер .assets-<версия> помечает, что всё скачано — повторные запуски мгновенны.
 */
export async function ensureAssets(mcVersion: string, installPath: string, win: BrowserWindow, assetId: string): Promise<void> {
  const assetRoot = join(installPath, 'assets')
  const indexPath = join(assetRoot, 'indexes', `${assetId}.json`)
  const marker = join(assetRoot, `.assets-${mcVersion}`)
  // Быстрый путь: всё уже скачано И индекс на диске валиден
  if (existsSync(marker) && indexValid(indexPath)) return

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

  let indexText: string
  let objects: Record<string, { hash: string }>
  try {
    const { data } = await axios.get(assetIndexUrl, { timeout: 15000, signal: opSignal(), responseType: 'text', transformResponse: (r) => r })
    indexText = String(data)
    objects = (JSON.parse(indexText).objects) || {}
  } catch {
    return
  }

  // Пишем валидный индекс атомарно (чинит битый/усечённый файл, который читает mclc)
  try {
    mkdirSync(dirname(indexPath), { recursive: true })
    const tmp = indexPath + '.tmp'
    writeFileSync(tmp, indexText)
    renameSync(tmp, indexPath)
  } catch { /* noop — mclc дотянет сам */ }

  // Уникальные хэши (несколько имён могут указывать на один объект)
  const hashes = [...new Set(Object.values(objects).map(o => o.hash))]
  const missing = hashes.filter(h => !existsSync(join(assetRoot, 'objects', h.slice(0, 2), h)))
  if (missing.length === 0) {
    try { writeFileSync(marker, '') } catch { /* noop */ }
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
