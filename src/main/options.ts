import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

// Управление строкой resourcePacks в options.txt.
// Формат: resourcePacks:["vanilla","file/Pack.zip"]

function optionsPath(gameRoot: string): string {
  return join(gameRoot, 'options.txt')
}

function readArray(content: string): { entries: string[]; lineIndex: number; lines: string[] } {
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('resourcePacks:')) {
      try {
        const arr = JSON.parse(lines[i].slice('resourcePacks:'.length))
        if (Array.isArray(arr)) return { entries: arr, lineIndex: i, lines }
      } catch { /* битая строка — перезапишем */ }
      return { entries: [], lineIndex: i, lines }
    }
  }
  return { entries: [], lineIndex: -1, lines }
}

function writeArray(gameRoot: string, entries: string[]): void {
  const path = optionsPath(gameRoot)
  const line = `resourcePacks:${JSON.stringify(entries)}`
  if (!existsSync(path)) {
    writeFileSync(path, line + '\n')
    return
  }
  const { lineIndex, lines } = readArray(readFileSync(path, 'utf8'))
  if (lineIndex >= 0) lines[lineIndex] = line
  else lines.push(line)
  writeFileSync(path, lines.join('\n'))
}

function entry(filename: string): string {
  return `file/${filename}`
}

/** Гарантирует, что указанные ресурспаки включены (для required при запуске). */
export function ensureResourcepacksEnabled(gameRoot: string, filenames: string[]): void {
  if (!filenames.length) return
  const path = optionsPath(gameRoot)
  const { entries } = existsSync(path) ? readArray(readFileSync(path, 'utf8')) : { entries: [] as string[] }
  let changed = false
  for (const f of filenames) {
    const e = entry(f)
    if (!entries.includes(e)) { entries.push(e); changed = true }
  }
  if (changed || !existsSync(path)) writeArray(gameRoot, entries)
}

/** Возвращает имена включённых ресурспаков (без префикса file/). */
export function getEnabledResourcepacks(gameRoot: string): string[] {
  const path = optionsPath(gameRoot)
  if (!existsSync(path)) return []
  const { entries } = readArray(readFileSync(path, 'utf8'))
  return entries.filter(e => e.startsWith('file/')).map(e => e.slice('file/'.length))
}

/** Включает/выключает ресурспак в options.txt. */
export function toggleResourcepack(gameRoot: string, filename: string, enabled: boolean): void {
  const path = optionsPath(gameRoot)
  const { entries } = existsSync(path) ? readArray(readFileSync(path, 'utf8')) : { entries: [] as string[] }
  const e = entry(filename)
  const has = entries.includes(e)
  if (enabled && !has) entries.push(e)
  else if (!enabled && has) entries.splice(entries.indexOf(e), 1)
  else return
  writeArray(gameRoot, entries)
}

/** Убирает ресурспак из options.txt (при удалении файла). */
export function removeResourcepackFromOptions(gameRoot: string, filename: string): void {
  toggleResourcepack(gameRoot, filename, false)
}
