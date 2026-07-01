import { join } from 'path'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import * as nbt from 'prismarine-nbt'
import { store } from './store'

export interface RecentWorld {
  kind: 'world'
  folder: string
  name: string
  lastPlayed: number
  mode: string
  version: string // версия MC, в которой сохранён мир (Data.Version.Name)
  icon: string | null // data URL иконки мира (saves/<world>/icon.png)
  score: number
}
export interface RecentServer {
  kind: 'server'
  name: string
  ip: string
  icon: string | null // data URL кэшированного фавикона из servers.dat
  score: number
}
export type RecentEntry = RecentWorld | RecentServer

const GAME_MODES = ['Выживание', 'Творческий', 'Приключение', 'Наблюдатель']
const DAY = 86400000

/** «Frecency»: свежесть (0..60) + частота (0..20). Как в Modrinth — недавние и частые выше. */
function frecency(last: number, count: number): number {
  const recency = last ? Math.max(0, 30 - (Date.now() - last) / DAY) * 2 : 0
  const freq = Math.min(count, 20)
  return recency + freq
}

/** Записывает факт запуска мира/сервера (key: 'w:<folder>' | 's:<ip>'). */
export function recordPlay(modpackId: string, key: string): void {
  const all = { ...(store.get('playStats') || {}) }
  const forPack = { ...(all[modpackId] || {}) }
  const prev = forPack[key] || { count: 0, last: 0 }
  forPack[key] = { count: prev.count + 1, last: Date.now() }
  all[modpackId] = forPack
  store.set('playStats', all)
}

/** Единый список «Продолжить игру» (миры + серверы), отсортированный по frecency, максимум 6. */
export async function getRecent(gameRoot: string, modpackId: string): Promise<RecentEntry[]> {
  const stats = (store.get('playStats') || {})[modpackId] || {}
  const worlds = await readWorlds(gameRoot, stats)
  const servers = await readServers(gameRoot, stats)
  return [...worlds, ...servers].sort((a, b) => b.score - a.score).slice(0, 6)
}

function readIcon(path: string): string | null {
  try {
    if (!existsSync(path)) return null
    return 'data:image/png;base64,' + readFileSync(path).toString('base64')
  } catch {
    return null
  }
}

type Stats = Record<string, { count: number; last: number }>

async function readWorlds(gameRoot: string, stats: Stats): Promise<RecentWorld[]> {
  const savesDir = join(gameRoot, 'saves')
  if (!existsSync(savesDir)) return []
  const out: RecentWorld[] = []
  for (const folder of readdirSync(savesDir)) {
    const dir = join(savesDir, folder)
    const levelDat = join(dir, 'level.dat')
    try {
      if (!statSync(dir).isDirectory() || !existsSync(levelDat)) continue
      const { parsed } = await nbt.parse(readFileSync(levelDat))
      const data = (parsed.value as any)?.Data?.value
      const name = data?.LevelName?.value ?? folder
      // LastPlayed — Long (может быть [high,low] или строкой)
      let lastPlayed = 0
      const lp = data?.LastPlayed?.value
      if (Array.isArray(lp)) lastPlayed = lp[0] * 4294967296 + (lp[1] >>> 0)
      else if (typeof lp === 'number') lastPlayed = lp
      else if (typeof lp === 'string') lastPlayed = Number(lp)
      if (!lastPlayed) lastPlayed = statSync(levelDat).mtimeMs
      const gt = data?.Player?.value?.playerGameType?.value ?? data?.GameType?.value ?? 0
      const version = data?.Version?.value?.Name?.value ?? ''
      const st = stats['w:' + folder]
      const last = Math.max(lastPlayed, st?.last ?? 0)
      out.push({
        kind: 'world',
        folder,
        name: String(name),
        lastPlayed,
        mode: GAME_MODES[gt] ?? 'Выживание',
        version: String(version),
        icon: readIcon(join(dir, 'icon.png')),
        score: frecency(last, st?.count ?? 0)
      })
    } catch {
      /* битый мир — пропускаем */
    }
  }
  return out
}

async function readServers(gameRoot: string, stats: Stats): Promise<RecentServer[]> {
  const file = join(gameRoot, 'servers.dat')
  if (!existsSync(file)) return []
  try {
    const { parsed } = await nbt.parse(readFileSync(file))
    const list = (parsed.value as any)?.servers?.value?.value
    if (!Array.isArray(list)) return []
    return list
      .map((s: any) => {
        const rawIcon = s.icon?.value
        const ip = s.ip?.value ?? ''
        const st = stats['s:' + ip]
        return {
          kind: 'server' as const,
          name: s.name?.value ?? ip ?? 'Сервер',
          ip,
          icon: typeof rawIcon === 'string' && rawIcon ? 'data:image/png;base64,' + rawIcon : null,
          // Сервер без статистики держим на умеренном уровне, чтобы он не терялся сразу
          score: Math.max(8, frecency(st?.last ?? 0, st?.count ?? 0))
        }
      })
      .filter((s: RecentServer) => s.ip)
  } catch {
    return []
  }
}
