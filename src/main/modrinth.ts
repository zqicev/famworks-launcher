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
  const facets: string[][] = [[`project_type:${type}`]]
  // Для сборок версия не задаётся (browser ищет по всем); для остального фильтруем по версии MC
  if (mcVersion) facets.push([`versions:${mcVersion}`])
  if (type === 'mod' && loader) facets.unshift([`categories:${loader}`])

  const res = await axios.get(`${BASE}/search`, {
    headers: HEADERS,
    params: { query, facets: JSON.stringify(facets), limit }
  })

  return res.data.hits
}

export interface ModrinthProject {
  id: string
  slug: string
  title: string
  description: string
  body: string
  icon_url: string | null
  downloads: number
  followers: number
  categories: string[]
  game_versions: string[]
  loaders: string[]
  client_side: string
  server_side: string
  source_url?: string | null
  issues_url?: string | null
  wiki_url?: string | null
  discord_url?: string | null
  license?: { id: string; name: string; url: string | null } | null
  gallery: { url: string; title?: string; description?: string; featured?: boolean }[]
}

export async function getModrinthProject(id: string): Promise<ModrinthProject> {
  const res = await axios.get(`${BASE}/project/${id}`, { headers: HEADERS })
  return res.data
}

/** Авторы проекта (ники участников команды). */
export async function getModrinthMembers(id: string): Promise<string[]> {
  const res = await axios.get(`${BASE}/project/${id}/members`, { headers: HEADERS })
  return (res.data as { user?: { username?: string } }[]).map(m => m.user?.username).filter((n): n is string => !!n)
}

// Автор (владелец проекта) + его аватар для строк модов. Кэш по id на время сессии.
export interface ModrinthAuthor { author: string | null; avatar: string | null }
const authorCache = new Map<string, ModrinthAuthor>()

async function fetchAuthor(id: string): Promise<ModrinthAuthor> {
  const cached = authorCache.get(id)
  if (cached) return cached
  let result: ModrinthAuthor = { author: null, avatar: null }
  try {
    const res = await axios.get(`${BASE}/project/${id}/members`, { headers: HEADERS })
    const members = (res.data ?? []) as { role?: string; user?: { username?: string; name?: string; avatar_url?: string } }[]
    const owner = members.find(m => m.role === 'Owner') ?? members[0]
    if (owner?.user) {
      result = { author: owner.user.name || owner.user.username || null, avatar: owner.user.avatar_url ?? null }
    }
  } catch { /* нет сети/проекта - вернётся пусто */ }
  authorCache.set(id, result)
  return result
}

/** id -> {author, avatar} владельца проекта Modrinth. Ограниченный параллелизм. */
export async function getModrinthAuthors(ids: string[]): Promise<Record<string, ModrinthAuthor>> {
  const uniq = [...new Set(ids.filter(Boolean))]
  const out: Record<string, ModrinthAuthor> = {}
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < uniq.length) {
      const id = uniq[next++]
      out[id] = await fetchAuthor(id)
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, uniq.length) }, worker))
  return out
}

/** Обязательные зависимости проекта — то, БЕЗ чего он не работает («от кого он зависит»).
 *  Берём required-зависимости самой свежей версии и подтягиваем к ним названия/иконки. */
export async function getModrinthDependencies(id: string): Promise<{ name: string; icon: string | null; slug: string }[]> {
  const [depsRes, verRes] = await Promise.all([
    axios.get(`${BASE}/project/${id}/dependencies`, { headers: HEADERS }),
    axios.get(`${BASE}/project/${id}/version`, { headers: HEADERS })
  ])
  const projects = (depsRes.data?.projects ?? []) as { id: string; title: string; icon_url: string | null; slug: string }[]
  const byId = new Map(projects.map(p => [p.id, p]))
  const versions = ((verRes.data ?? []) as { date_published: string; dependencies?: { project_id?: string; dependency_type?: string }[] }[])
    .slice()
    .sort((a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime())

  const required = (versions[0]?.dependencies ?? []).filter(d => d.dependency_type === 'required' && d.project_id)
  const seen = new Set<string>()
  const out: { name: string; icon: string | null; slug: string }[] = []
  for (const d of required) {
    const pid = d.project_id as string
    if (seen.has(pid)) continue
    seen.add(pid)
    const p = byId.get(pid)
    out.push({ name: p?.title ?? pid, icon: p?.icon_url ?? null, slug: p?.slug ?? '' })
  }
  return out
}

/** Иконки проектов Modrinth по их id одним bulk-запросом (для списка модов). id -> icon_url|null. */
export async function getModrinthIcons(ids: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return out
  try {
    const res = await axios.get(`${BASE}/projects`, { headers: HEADERS, params: { ids: JSON.stringify(uniq) } })
    for (const p of (res.data ?? []) as { id: string; icon_url: string | null }[]) out[p.id] = p.icon_url ?? null
  } catch { /* нет сети - вернётся пусто, останутся буквы */ }
  return out
}

export interface ModrinthDependency {
  project_id?: string
  version_id?: string
  dependency_type: string // required | optional | incompatible | embedded
}

export interface ModrinthVersion {
  id: string
  name: string
  version_number: string
  files: { url: string; filename: string; primary: boolean; size: number; hashes?: { sha512?: string } }[]
  dependencies?: ModrinthDependency[]
  project_id?: string
  version_type?: string    // release | beta | alpha
  date_published?: string  // ISO
}

export async function getModVersions(projectId: string, mcVersion: string, loader: string, type = 'mod'): Promise<ModrinthVersion[]> {
  const loaders = type === 'mod' ? [loader] : type === 'shader' ? ['iris'] : ['minecraft']
  const res = await axios.get(`${BASE}/project/${projectId}/version`, {
    headers: HEADERS,
    params: { game_versions: JSON.stringify([mcVersion]), loaders: JSON.stringify(loaders) }
  })
  return res.data
}

/** Конкретная версия по её id (для установки запинованной зависимости). */
export async function getModrinthVersion(id: string): Promise<ModrinthVersion | null> {
  try {
    const res = await axios.get(`${BASE}/version/${id}`, { headers: HEADERS })
    return res.data
  } catch {
    return null
  }
}

/** Версия Modrinth по sha1 файла - чтобы понять, что за мод лежит в папке. null - файл не с Modrinth. */
export async function getModrinthVersionByHash(sha1: string): Promise<ModrinthVersion | null> {
  try {
    const res = await axios.get(`${BASE}/version_file/${sha1}`, { headers: HEADERS, params: { algorithm: 'sha1' } })
    return res.data
  } catch {
    return null
  }
}

/** Проекты Modrinth по sha1 файлов одним запросом. sha1(hex) -> project_id|null (нет на Modrinth). */
export async function getProjectIdsByHashes(sha1s: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  const uniq = [...new Set(sha1s.filter(Boolean))]
  if (!uniq.length) return out
  try {
    const res = await axios.post(`${BASE}/version_files`, { hashes: uniq, algorithm: 'sha1' }, { headers: HEADERS })
    const data = (res.data ?? {}) as Record<string, { project_id?: string }>
    for (const h of uniq) out[h] = data[h]?.project_id ?? null
  } catch { /* нет сети - вернётся пусто */ }
  return out
}
