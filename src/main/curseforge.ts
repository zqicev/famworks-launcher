import axios from 'axios'

// CurseForge берём через собственный прокси (Cloudflare Worker) — CF-ключ живёт там, в клиент не попадает.
// APP_TOKEN защищает прокси от посторонних; он в клиенте, но даёт доступ только к урезанному MC-only прокси
// и легко меняется на стороне Worker без замены CF-ключа.
const PROXY = 'https://famlauncher.zqicev.workers.dev'
const APP_TOKEN = 'd03e58f2-32e4-4f05-975e-fbe358cea1ff0978b070-3d0c-43b0-8cef-ceb33f7e7dde'

// classId: моды=6, ресурспаки=12, шейдеры=6552, сборки=4471
const CLASS_ID: Record<string, number> = { mod: 6, resourcepack: 12, shader: 6552, modpack: 4471 }
// modLoaderType: Forge=1, Fabric=4, Quilt=5, NeoForge=6
const LOADER_TYPE: Record<string, number> = { fabric: 4, forge: 1, quilt: 5, neoforge: 6 }

function headers() {
  return { 'x-app-token': APP_TOKEN, Accept: 'application/json' }
}

export interface CfHit {
  id: number
  name: string
  slug: string
  summary: string
  downloadCount: number
  authors: { name: string }[]
  logo?: { thumbnailUrl?: string }
  links?: { websiteUrl?: string }
}

export interface CfFile {
  id: number
  fileName: string
  displayName: string
  downloadUrl: string | null
  fileLength: number
  hashes: { value: string; algo: number }[] // algo 1=sha1, 2=md5
  gameVersions: string[]
  // relationType: 1=embedded, 2=optional, 3=required, 4=tool, 5=incompatible, 6=include
  dependencies?: { modId: number; relationType: number }[]
}

export async function searchCurseforge(query: string, mcVersion: string, loader: string, type = 'mod'): Promise<CfHit[]> {
  const params: Record<string, unknown> = {
    classId: CLASS_ID[type] ?? 6,
    searchFilter: query,
    sortField: 2, // Popularity
    sortOrder: 'desc',
    pageSize: 20
  }
  if (mcVersion) params.gameVersion = mcVersion // для сборок версия не задаётся
  if (type === 'mod') params.modLoaderType = LOADER_TYPE[loader] ?? 4
  const res = await axios.get(`${PROXY}/v1/mods/search`, { headers: headers(), params, timeout: 15000 })
  return res.data.data
}

export async function getCurseforgeFiles(modId: number, mcVersion: string, loader: string, type = 'mod'): Promise<CfFile[]> {
  const params: Record<string, unknown> = { gameVersion: mcVersion, pageSize: 30 }
  if (type === 'mod') params.modLoaderType = LOADER_TYPE[loader] ?? 4
  const res = await axios.get(`${PROXY}/v1/mods/${modId}/files`, { headers: headers(), params, timeout: 15000 })
  return res.data.data
}

export function cfSha1(file: CfFile): string | undefined {
  return file.hashes.find(h => h.algo === 1)?.value
}

export interface CfMod {
  id: number
  name: string
  slug: string
  summary: string
  downloadCount: number
  authors: { name: string; url?: string }[]
  categories: { name: string }[]
  logo?: { thumbnailUrl?: string; url?: string }
  screenshots?: { thumbnailUrl?: string; url?: string; title?: string }[]
  links?: { websiteUrl?: string; wikiUrl?: string; issuesUrl?: string; sourceUrl?: string }
  latestFilesIndexes?: { gameVersion: string }[]
}

// Детали проекта (для страницы обзора). Полное описание (/description) прокси не отдаёт — только summary.
export async function getCurseforgeMod(id: number): Promise<CfMod> {
  const res = await axios.get(`${PROXY}/v1/mods/${id}`, { headers: headers(), timeout: 15000 })
  return res.data.data
}
