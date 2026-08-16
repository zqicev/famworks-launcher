import { join } from 'path'
import { readdirSync, statSync, existsSync, rmSync } from 'fs'

// Папки уровня installPath, которые НЕ являются сборками — не трогаем.
const RESERVED = new Set(['assets', 'runtime'])
// Мусор внутри папки сборки: пересоздаётся при необходимости, удалять безопасно.
//  - assets  — теперь общий кэш на уровне installPath, per-pack копия лишняя
//  - .loader — installer-jar'ы Forge/NeoForge, нужны только в момент установки
const JUNK_SUBDIRS = ['assets', '.loader']

function dirSize(dir: string): number {
  let total = 0
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return 0 }
  for (const e of entries) {
    const p = join(dir, e)
    let st: ReturnType<typeof statSync>
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) total += dirSize(p)
    else total += st.size
  }
  return total
}

/** Чистит сборки от заведомо лишнего (per-pack ассеты + installer-jar'ы загрузчиков).
 *  Не трогает моды, миры, конфиги, ресурспаки/шейдеры, version-профили, библиотеки,
 *  общий кэш ассетов и Java. Возвращает освобождённые байты и число затронутых сборок. */
export function cleanupJunk(installPath: string): { freedBytes: number; instances: number } {
  let freedBytes = 0
  let instances = 0
  let dirs: string[]
  try { dirs = readdirSync(installPath) } catch { return { freedBytes: 0, instances: 0 } }

  for (const name of dirs) {
    if (RESERVED.has(name)) continue
    const packDir = join(installPath, name)
    try { if (!statSync(packDir).isDirectory()) continue } catch { continue }
    // Похоже на папку сборки? (есть mods/versions/assets) — иначе не трогаем чужое.
    const looksLikePack = existsSync(join(packDir, 'mods')) || existsSync(join(packDir, 'versions')) || existsSync(join(packDir, 'assets'))
    if (!looksLikePack) continue

    let touched = false
    for (const junk of JUNK_SUBDIRS) {
      const jd = join(packDir, junk)
      if (!existsSync(jd)) continue
      freedBytes += dirSize(jd)
      try { rmSync(jd, { recursive: true, force: true }); touched = true } catch { /* залочено — пропускаем */ }
    }
    if (touched) instances++
  }
  return { freedBytes, instances }
}
