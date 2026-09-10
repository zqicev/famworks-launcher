import AdmZip from 'adm-zip'
import { join } from 'path'

// Иконка мода/ресурспака прямо из архива (.jar/.zip), когда нет иконки Modrinth.
// Источники по приоритету: Fabric (fabric.mod.json.icon) -> Quilt -> Forge/NeoForge
// (META-INF/mods.toml logoFile, лежит в корне) -> resourcepack pack.png.

function toDataUrl(name: string, buf: Buffer): string {
  const n = name.toLowerCase()
  const mime = n.endsWith('.jpg') || n.endsWith('.jpeg') ? 'image/jpeg' : n.endsWith('.gif') ? 'image/gif' : 'image/png'
  return `data:${mime};base64,${buf.toString('base64')}`
}

function extractArchiveIcon(path: string): string | null {
  let zip: AdmZip
  try { zip = new AdmZip(path) } catch { return null }
  const read = (p: string): Buffer | null => { try { const e = zip.getEntry(p); return e ? e.getData() : null } catch { return null } }

  // Fabric: icon = "assets/mod/icon.png" ИЛИ { "128": "path" }
  const fabric = read('fabric.mod.json')
  if (fabric) {
    try {
      const j = JSON.parse(fabric.toString('utf8'))
      const icon: unknown = typeof j.icon === 'string' ? j.icon : j.icon && Object.values(j.icon)[0]
      if (typeof icon === 'string') { const b = read(icon); if (b) return toDataUrl(icon, b) }
    } catch { /* битый json - пропускаем */ }
  }
  // Quilt
  const quilt = read('quilt.mod.json')
  if (quilt) {
    try {
      const j = JSON.parse(quilt.toString('utf8'))
      const icon = j?.quilt_loader?.metadata?.icon
      const p = typeof icon === 'string' ? icon : icon && Object.values(icon)[0]
      if (typeof p === 'string') { const b = read(p); if (b) return toDataUrl(p, b) }
    } catch { /* пропускаем */ }
  }
  // Forge / NeoForge: logoFile в корне архива
  const toml = read('META-INF/mods.toml') || read('META-INF/neoforge.mods.toml')
  if (toml) {
    const m = /logoFile\s*=\s*["']([^"']+)["']/.exec(toml.toString('utf8'))
    if (m && m[1]) { const b = read(m[1].replace(/^\/+/, '')); if (b) return toDataUrl(m[1], b) }
  }
  // Resourcepack (и часть шейдерпаков)
  const packPng = read('pack.png')
  if (packPng) return toDataUrl('pack.png', packPng)

  return null
}

/** filename -> data-URL|null для файлов из папки dir. Пустой ввод -> пустой результат. */
export function getLocalIcons(dir: string, filenames: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const name of [...new Set(filenames)]) {
    if (!name) continue
    out[name] = extractArchiveIcon(join(dir, name))
  }
  return out
}
