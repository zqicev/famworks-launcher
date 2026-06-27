import axios from 'axios'
import { ModpackIndex, Modpack } from '../types/modpack'

// Сборки хранятся в отдельном публичном репозитории famworks-builds.
const GITHUB_BASE = 'https://raw.githubusercontent.com/zqicev/famworks-builds/main/modpacks'
const FALLBACK_BASE = '' // TODO: добавить fallback URL (Cloudflare R2 и т.д.)

async function fetchJson<T>(url: string): Promise<T> {
  // cache-busting: GitHub raw кэширует на ~5 мин, ?t= даёт свежие данные после обновления сборки
  const res = await axios.get<T>(`${url}?t=${Date.now()}`, { timeout: 8000 })
  return res.data
}

async function fetchWithFallback<T>(path: string): Promise<T> {
  try {
    return await fetchJson<T>(`${GITHUB_BASE}/${path}`)
  } catch {
    if (FALLBACK_BASE) {
      return await fetchJson<T>(`${FALLBACK_BASE}/${path}`)
    }
    throw new Error(`Failed to fetch ${path}`)
  }
}

export async function fetchModpackIndex(): Promise<ModpackIndex> {
  const data = await fetchWithFallback<ModpackIndex>('index.json')
  if (!data || !Array.isArray(data.modpacks)) {
    throw new Error('Некорректный index.json: отсутствует список сборок')
  }
  return data
}

// Modrinth project id для Fabric API
const FABRIC_API_PROJECT = 'P7dR8mSH'

/** По полю fabric_api_version гарантирует Fabric API именно нужной версии (обязательный мод).
 *  Если запись Fabric API уже есть в списке — пиннит её к версии; иначе добавляет новую. */
function injectFabricApi(mp: Modpack): void {
  if (mp.loader !== 'fabric' || !mp.fabric_api_version) return
  const ver = mp.fabric_api_version
  const existing = mp.mods.find(m => m.id === 'fabric-api' || m.modrinth_id === FABRIC_API_PROJECT)
  if (existing) {
    // Если задан кастомный download_url — не трогаем (мейнтейнер явно указал файл)
    if (!existing.download_url) {
      existing.modrinth_id = FABRIC_API_PROJECT
      existing.modrinth_version_number = ver
      existing.filename = `fabric-api-${ver}.jar`
      existing.version = ver
      existing.required = true
    }
    return
  }
  mp.mods.unshift({
    id: 'fabric-api',
    name: 'Fabric API',
    modrinth_id: FABRIC_API_PROJECT,
    modrinth_version_number: ver,
    filename: `fabric-api-${ver}.jar`,
    version: ver,
    category: 'API',
    size_mb: 2.5,
    required: true
  })
}

export async function fetchModpack(id: string): Promise<Modpack> {
  const data = await fetchWithFallback<Modpack>(`${id}.json`)
  // Защита от битого/неполного JSON на GitHub — нормализуем обязательные поля.
  if (!data || typeof data !== 'object') {
    throw new Error(`Некорректные данные сборки ${id}`)
  }
  if (!Array.isArray(data.mods)) data.mods = []
  if (!Array.isArray(data.changelog)) data.changelog = []
  if (!data.mc_version || !data.loader || !data.loader_version) {
    throw new Error(`В сборке ${id} не хватает обязательных полей (mc_version/loader/loader_version)`)
  }
  injectFabricApi(data)
  return data
}
