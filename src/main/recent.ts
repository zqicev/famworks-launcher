import { join } from 'path'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import * as nbt from 'prismarine-nbt'

export interface RecentWorld {
  kind: 'world'
  folder: string
  name: string
  lastPlayed: number
}
export interface RecentServer {
  kind: 'server'
  name: string
  ip: string
}
export type RecentEntry = RecentWorld | RecentServer

/** Читает миры (saves) и серверы (servers.dat) сборки. */
export async function getRecent(gameRoot: string): Promise<{ worlds: RecentWorld[]; servers: RecentServer[] }> {
  return { worlds: await readWorlds(gameRoot), servers: await readServers(gameRoot) }
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
      if (Array.isArray(lp)) lastPlayed = (lp[0] * 4294967296) + (lp[1] >>> 0)
      else if (typeof lp === 'number') lastPlayed = lp
      else if (typeof lp === 'string') lastPlayed = Number(lp)
      if (!lastPlayed) lastPlayed = statSync(levelDat).mtimeMs
      out.push({ kind: 'world', folder, name: String(name), lastPlayed })
    } catch { /* битый мир — пропускаем */ }
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
    return list.map((s: any) => ({ kind: 'server' as const, name: s.name?.value ?? s.ip?.value ?? 'Сервер', ip: s.ip?.value ?? '' }))
      .filter((s: RecentServer) => s.ip)
  } catch {
    return []
  }
}
