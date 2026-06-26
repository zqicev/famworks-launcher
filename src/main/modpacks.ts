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
  return fetchWithFallback<ModpackIndex>('index.json')
}

export async function fetchModpack(id: string): Promise<Modpack> {
  return fetchWithFallback<Modpack>(`${id}.json`)
}
