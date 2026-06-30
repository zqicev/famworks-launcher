import axios from 'axios'
import { store } from './store'

const BASE = 'https://api.curseforge.com/v1'
const GAME_ID = 432 // Minecraft

// classId: моды=6, ресурспаки=12, шейдеры=6552
const CLASS_ID: Record<string, number> = { mod: 6, resourcepack: 12, shader: 6552 }
// modLoaderType: Forge=1, Fabric=4, Quilt=5, NeoForge=6
const LOADER_TYPE: Record<string, number> = { fabric: 4, forge: 1, quilt: 5, neoforge: 6 }

function headers() {
  return { 'x-api-key': store.get('cfKey') as string, Accept: 'application/json' }
}

export interface CfHit {
  id: number
  name: string
  summary: string
  downloadCount: number
  authors: { name: string }[]
  logo?: { thumbnailUrl?: string }
}

export interface CfFile {
  id: number
  fileName: string
  displayName: string
  downloadUrl: string | null
  fileLength: number
  hashes: { value: string; algo: number }[] // algo 1=sha1, 2=md5
  gameVersions: string[]
}

export async function searchCurseforge(query: string, mcVersion: string, loader: string, type = 'mod'): Promise<CfHit[]> {
  const params: Record<string, unknown> = {
    gameId: GAME_ID,
    classId: CLASS_ID[type] ?? 6,
    searchFilter: query,
    gameVersion: mcVersion,
    sortField: 2, // Popularity
    sortOrder: 'desc',
    pageSize: 20
  }
  if (type === 'mod') params.modLoaderType = LOADER_TYPE[loader] ?? 4
  const res = await axios.get(`${BASE}/mods/search`, { headers: headers(), params, timeout: 15000 })
  return res.data.data
}

export async function getCurseforgeFiles(modId: number, mcVersion: string, loader: string, type = 'mod'): Promise<CfFile[]> {
  const params: Record<string, unknown> = { gameVersion: mcVersion, pageSize: 30 }
  if (type === 'mod') params.modLoaderType = LOADER_TYPE[loader] ?? 4
  const res = await axios.get(`${BASE}/mods/${modId}/files`, { headers: headers(), params, timeout: 15000 })
  return res.data.data
}

/** Проверка ключа CurseForge — минимальный поиск (тот же эндпоинт, что используем). */
export async function validateCfKey(): Promise<boolean> {
  try {
    await axios.get(`${BASE}/mods/search`, { headers: headers(), params: { gameId: GAME_ID, pageSize: 1 }, timeout: 10000 })
    return true
  } catch {
    return false
  }
}

/** Если downloadUrl null (автор закрыл API-раздачу) — собираем CDN-ссылку из fileId. */
export function cfDownloadUrl(file: CfFile): string {
  if (file.downloadUrl) return file.downloadUrl
  const id = file.id.toString()
  const a = id.slice(0, 4)
  const b = String(Number(id.slice(4))) // без ведущих нулей
  return `https://edge.forgecdn.net/files/${a}/${b}/${encodeURIComponent(file.fileName)}`
}

export function cfSha1(file: CfFile): string | undefined {
  return file.hashes.find(h => h.algo === 1)?.value
}
