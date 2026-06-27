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

export async function searchModrinth(query: string, mcVersion: string, loader: string, limit = 20): Promise<ModrinthHit[]> {
  const facets = JSON.stringify([
    [`categories:${loader}`],
    [`versions:${mcVersion}`],
    ['project_type:mod']
  ])
  const res = await axios.get(`${BASE}/search`, {
    headers: HEADERS,
    params: { query, facets, limit }
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

/** Берёт последнюю совместимую версию проекта под нужные mc/loader. */
export async function getLatestVersion(projectId: string, mcVersion: string, loader: string): Promise<ModrinthVersion | null> {
  const res = await axios.get(`${BASE}/project/${projectId}/version`, {
    headers: HEADERS,
    params: { game_versions: JSON.stringify([mcVersion]), loaders: JSON.stringify([loader]) }
  })
  const versions: ModrinthVersion[] = res.data
  return versions[0] ?? null
}
