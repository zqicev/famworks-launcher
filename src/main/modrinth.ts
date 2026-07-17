import axios from 'axios'

const BASE = 'https://api.modrinth.com/v2'
const HEADERS = { 'User-Agent': 'famworks-editor/1.0' }

export interface ModrinthHit {
  project_id: string
  slug: string
  title: string
  description: string
  author: string
  downloads: number
  icon_url: string | null
  categories: string[]
}

export async function searchModrinth(query: string, mcVersion: string, loader: string, type = 'mod', limit = 20): Promise<ModrinthHit[]> {
  // Ресурспаки/шейдеры не привязаны к загрузчику — фильтр по loader только для модов
  const facets = [
    [`versions:${mcVersion}`],
    [`project_type:${type}`]
  ]
  if (type === 'mod') facets.unshift([`categories:${loader}`])
  const res = await axios.get(`${BASE}/search`, {
    headers: HEADERS,
    params: { query, facets: JSON.stringify(facets), limit }
  })
  return res.data.hits
}

export interface ModrinthFile {
  url: string
  filename: string
  primary: boolean
  size: number
  hashes: { sha512?: string; sha1?: string }
}
export interface ModrinthVersion {
  id: string
  name: string
  version_number: string
  files: ModrinthFile[]
}

/** Все совместимые версии проекта под нужные mc/loader (новые — первыми). */
export async function getVersions(projectId: string, mcVersion: string, loader: string, type = 'mod'): Promise<ModrinthVersion[]> {
  // loader на Modrinth: моды — fabric/forge, ресурспаки — minecraft, шейдеры — iris
  const wantLoader = type === 'mod' ? loader : type === 'shader' ? 'iris' : 'minecraft'
  // ВАЖНО: фильтрованный запрос (game_versions+loaders) у Modrinth для крупных проектов
  // (напр. Fabric API) зависает и отдаёт 408. Без фильтра все версии тянутся нормально —
  // забираем их и фильтруем на клиенте. Ретраи — на случай сетевого сбоя.
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await axios.get(`${BASE}/project/${projectId}/version`, { headers: HEADERS, timeout: 20000 })
      const all = res.data as (ModrinthVersion & { game_versions?: string[]; loaders?: string[] })[]
      return all.filter(v => v.game_versions?.includes(mcVersion) && v.loaders?.includes(wantLoader))
    } catch (e) {
      lastErr = e
      await new Promise(r => setTimeout(r, 500 * attempt))
    }
  }
  throw lastErr
}

/** Берёт последнюю совместимую версию проекта под нужные mc/loader. */
export async function getLatestVersion(projectId: string, mcVersion: string, loader: string, type = 'mod'): Promise<ModrinthVersion | null> {
  const versions = await getVersions(projectId, mcVersion, loader, type)
  return versions[0] ?? null
}
