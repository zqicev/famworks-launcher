import axios from 'axios'
import { getPortalToken } from './portal'

// API источника модов FamWorks на портале. Токен необязателен: без него отдаётся только release.
const BASE = 'https://portal.famworks.ru/api/launcher/mods'

export interface FwFile {
  url: string
  filename: string
  size: number
  primary?: boolean
  hashes: { sha512?: string; sha1?: string }
}
export interface FwVersion {
  id: string
  name: string
  kind: 'mod' | 'resourcepack' | 'shader'
  channel: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  environment?: string
  changelog?: string
  date_published?: string
  files: FwFile[]
}
export interface FwResolveEntry {
  id: string
  status: 'ok' | 'not_found' | 'no_compatible'
  version?: FwVersion
}
export interface FwResolve { testing: boolean; mods: FwResolveEntry[] }
export interface FwAccess { paired: boolean; catalog: boolean; testing: boolean }
export interface FwCatalogItem {
  id: string
  name: string
  kind: 'mod' | 'resourcepack' | 'shader'
  description?: string
  release: FwVersion | null
  test: FwVersion | null
}

function headers(): Record<string, string> {
  const t = getPortalToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

/** Один запрос на всю сборку: какие версии наших модов ставить. */
export async function resolveFamworks(
  mcVersion: string,
  loader: string,
  mods: { id: string; channel?: string; version?: string }[]
): Promise<FwResolve> {
  const res = await axios.post(`${BASE}/resolve`, { mc_version: mcVersion, loader, mods }, {
    headers: headers(), timeout: 15000, validateStatus: s => s === 200
  })
  return res.data as FwResolve
}

/** Что показывать: вкладку каталога и переключатели test/release. Безопасно падает в «ничего нельзя». */
export async function famworksAccess(): Promise<FwAccess> {
  try {
    const res = await axios.get(`${BASE}/access`, { headers: headers(), timeout: 10000, validateStatus: s => s === 200 })
    return res.data as FwAccess
  } catch {
    return { paired: false, catalog: false, testing: false }
  }
}

/** Каталог наших модов (нужно право каталога, иначе 403). */
export async function famworksCatalog(params: {
  mc_version?: string; loader?: string; kind?: string; q?: string
}): Promise<FwCatalogItem[]> {
  const res = await axios.get(`${BASE}/catalog`, { headers: headers(), params, timeout: 12000, validateStatus: s => s === 200 })
  return (res.data as FwCatalogItem[]) ?? []
}

/** Все версии мода (для фиксации версии в редакторе). */
export async function famworksVersions(id: string): Promise<FwVersion[]> {
  const res = await axios.get(`${BASE}/catalog/${encodeURIComponent(id)}/versions`, {
    headers: headers(), timeout: 12000, validateStatus: s => s === 200
  })
  return (res.data as FwVersion[]) ?? []
}
