import axios from 'axios'

const BASE = 'https://api.modrinth.com/v2'
const HEADERS = { 'User-Agent': 'famworks-launcher/1.0' }

export interface ModrinthSearchResult {
  project_id: string
  slug: string
  title: string
  description: string
  author: string
  downloads: number
  icon_url: string | null
  categories: string[]
  latest_version: string
}

export async function searchModrinth(
  query: string,
  mcVersion: string,
  loader: string = 'fabric',
  type = 'mod',
  limit = 20
): Promise<ModrinthSearchResult[]> {
  const facets: string[][] = [
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

export interface ModrinthVersion {
  id: string
  name: string
  version_number: string
  files: { url: string; filename: string; primary: boolean; size: number }[]
}

export async function getModVersions(projectId: string, mcVersion: string, loader: string, type = 'mod'): Promise<ModrinthVersion[]> {
  const loaders = type === 'mod' ? [loader] : ['minecraft']
  const res = await axios.get(`${BASE}/project/${projectId}/version`, {
    headers: HEADERS,
    params: { game_versions: JSON.stringify([mcVersion]), loaders: JSON.stringify(loaders) }
  })
  return res.data
}
