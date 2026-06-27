import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import * as nbt from 'prismarine-nbt'
import { ServerEntry } from '../types/modpack'

interface RawServer {
  name?: { value: string }
  ip?: { value: string }
  [k: string]: unknown
}

function fullIp(s: ServerEntry): string {
  return s.port && s.port !== 25565 ? `${s.ip}:${s.port}` : s.ip
}

/**
 * Вмёрживает серверы сборки в servers.dat (NBT, без сжатия), сохраняя серверы,
 * которые игрок добавил сам. Совпадение — по ip; имя обновляем.
 */
export async function writeServers(gameRoot: string, servers: ServerEntry[]): Promise<void> {
  if (!servers || servers.length === 0) return

  const file = join(gameRoot, 'servers.dat')

  // Читаем существующие серверы (если есть и парсятся)
  let existing: RawServer[] = []
  if (existsSync(file)) {
    try {
      const { parsed } = await nbt.parse(readFileSync(file))
      const list = (parsed.value as any)?.servers?.value?.value
      if (Array.isArray(list)) existing = list
    } catch {
      existing = []
    }
  }

  // Индекс по ip
  const byIp = new Map<string, RawServer>()
  for (const s of existing) {
    const ip = s.ip?.value
    if (ip) byIp.set(ip, s)
  }

  // Управляемые серверы — наверх и в начало списка
  const managed: RawServer[] = []
  const managedIps = new Set<string>()
  for (const s of servers) {
    const ip = fullIp(s)
    managedIps.add(ip)
    managed.push({
      name: { type: 'string', value: s.name } as any,
      ip: { type: 'string', value: ip } as any
    })
  }

  // Остальные (добавленные игроком), которых нет среди управляемых
  const others = existing.filter(s => {
    const ip = s.ip?.value
    return ip && !managedIps.has(ip)
  })

  const finalList = [...managed, ...others]

  const data = {
    type: 'compound' as const,
    name: '',
    value: {
      servers: {
        type: 'list' as const,
        value: { type: 'compound' as const, value: finalList as any }
      }
    }
  }

  const buf = nbt.writeUncompressed(data as any)
  writeFileSync(file, buf)
}
