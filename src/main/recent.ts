import { join } from 'path'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import * as nbt from 'prismarine-nbt'

export interface RecentWorld {
  kind: 'world'
  folder: string
  name: string
  lastPlayed: number
  mode: string
  icon: string | null // data URL иконки мира (saves/<world>/icon.png)
}
export interface RecentServer {
  kind: 'server'
  name: string
  ip: string
  icon: string | null // data URL кэшированного фавикона из servers.dat
}
export type RecentEntry = RecentWorld | RecentServer

const GAME_MODES = ['Выживание', 'Творческий', 'Приключение', 'Наблюдатель']

/** Читает миры (saves) и серверы (servers.dat) сборки. */
export async function getRecent(gameRoot: string): Promise<{ worlds: RecentWorld[]; servers: RecentServer[] }> {
  return { worlds: await readWorlds(gameRoot), servers: await readServers(gameRoot) }
}

function readIcon(path: string): string | null {
  try {
    if (!existsSync(path)) return null
    return 'data:image/png;base64,' + readFileSync(path).toString('base64')
  } catch {
    return null
  }
}

async function readWorlds(gameRoot: string): Promise<RecentWorld[]> {
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
      out.push({
        kind: 'world',
        folder,
        name: String(name),
        lastPlayed,
        mode: GAME_MODES[gt] ?? 'Выживание',
        icon: readIcon(join(dir, 'icon.png'))
      })
    } catch {
      /* битый мир — пропускаем */
    }
  }
  return out.sort((a, b) => b.lastPlayed - a.lastPlayed)
}

async function readServers(gameRoot: string): Promise<RecentServer[]> {
  const file = join(gameRoot, 'servers.dat')
  if (!existsSync(file)) return []
  try {
    const { parsed } = await nbt.parse(readFileSync(file))
    const list = (parsed.value as any)?.servers?.value?.value
    if (!Array.isArray(list)) return []
    return list
      .map((s: any) => {
        const rawIcon = s.icon?.value
        return {
          kind: 'server' as const,
          name: s.name?.value ?? s.ip?.value ?? 'Сервер',
          ip: s.ip?.value ?? '',
          icon: typeof rawIcon === 'string' && rawIcon ? 'data:image/png;base64,' + rawIcon : null
        }
      })
      .filter((s: RecentServer) => s.ip)
  } catch {
    return []
  }
}
