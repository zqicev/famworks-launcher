import { join } from 'path'
import { Dirent } from 'fs'
import { readdir, stat, rm } from 'fs/promises'

// Папки уровня installPath, которые НЕ являются сборками — не трогаем.
const RESERVED = new Set(['assets', 'runtime'])
// Мусор внутри папки сборки: пересоздаётся при необходимости, удалять безопасно.
//  - assets  — теперь общий кэш на уровне installPath, per-pack копия лишняя
//  - .loader — installer-jar'ы Forge/NeoForge, нужны только в момент установки
const JUNK_SUBDIRS = ['assets', '.loader']

/** Рекурсивный размер папки. Асинхронно — чтобы не блокировать главный процесс (иначе UI виснет). */
async function dirSize(dir: string): Promise<number> {
  let total = 0
  let entries: Dirent[]
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return 0 }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) total += await dirSize(p)
    else { try { total += (await stat(p)).size } catch { /* пропускаем */ } }
  }
  return total
}

/** Чистит сборки от заведомо лишнего (per-pack ассеты + installer-jar'ы загрузчиков).
 *  Не трогает моды, миры, конфиги, ресурспаки/шейдеры, version-профили, библиотеки,
 *  общий кэш ассетов и Java. Всё через async fs, чтобы не подвешивать интерфейс.
 *  Возвращает освобождённые байты и число затронутых сборок. */
export async function cleanupJunk(installPath: string): Promise<{ freedBytes: number; instances: number }> {
  let freedBytes = 0
  let instances = 0
  let dirs: Dirent[]
  try { dirs = await readdir(installPath, { withFileTypes: true }) } catch { return { freedBytes: 0, instances: 0 } }

  for (const d of dirs) {
    if (!d.isDirectory() || RESERVED.has(d.name)) continue
    const packDir = join(installPath, d.name)
    // Похоже на папку сборки? (есть mods/versions/assets) — иначе не трогаем чужое.
    let looksLikePack = false
    for (const probe of ['mods', 'versions', 'assets']) {
      try { await stat(join(packDir, probe)); looksLikePack = true; break } catch { /* нет — пробуем дальше */ }
    }
    if (!looksLikePack) continue

    let touched = false
    for (const junk of JUNK_SUBDIRS) {
      const jd = join(packDir, junk)
      const size = await dirSize(jd) // 0, если папки нет
      if (size === 0) continue
      try { await rm(jd, { recursive: true, force: true }); freedBytes += size; touched = true } catch { /* залочено — пропускаем */ }
    }
    if (touched) instances++
  }
  return { freedBytes, instances }
}
