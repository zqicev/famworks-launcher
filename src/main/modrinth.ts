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
  limit = 20
): Promise<ModrinthSearchResult[]> {
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

export interface ModrinthVersion {
  id: string
  name: string
  version_number: string
  files: { url: string; filename: string; primary: boolean; size: number }[]
}

export async function getModVersions(projectId: string, mcVersion: string, loader: string): Promise<ModrinthVersion[]> {
  const res = await axios.get(`${BASE}/project/${projectId}/version`, {
    headers: HEADERS,
    params: { game_versions: JSON.stringify([mcVersion]), loaders: JSON.stringify([loader]) }
  })
  return res.data
}
