/// <reference types="vite/client" />

import type { Modpack, LoadedModpack } from '../../types/modpack'

interface TokenResult { ok: boolean; login?: string; error?: string }

interface ModrinthHit {
  project_id: string
  slug: string
  title: string
  description: string
  author: string
  downloads: number
  icon_url: string | null
  categories: string[]
}
interface ModrinthFile { url: string; filename: string; primary: boolean; size: number; hashes: { sha512?: string } }
interface ModrinthVersion { id: string; name: string; version_number: string; files: ModrinthFile[] }

interface JarUpload { filename: string; download_url: string; sha512: string; size_mb: number }

declare global {
  interface Window {
    api: {
      cfg: {
        get: (key: string) => Promise<unknown>
        set: (key: string, value: unknown) => Promise<void>
        validateToken: () => Promise<TokenResult>
      }
      ws: {
        load: () => Promise<{ packs: Record<string, LoadedModpack>; missing: string[] }>
        save: (modpack: Modpack, fileSha: string | null) => Promise<{ fileSha: string }>
        delete: (id: string, fileSha: string) => Promise<void>
      }
      modrinth: {
        search: (q: string, mc: string, loader: string) => Promise<ModrinthHit[]>
        latest: (projectId: string, mc: string, loader: string) => Promise<ModrinthVersion | null>
      }
      jar: { pickAndUpload: () => Promise<JarUpload | null> }
      win: { minimize: () => void; close: () => void }
    }
  }
}

export {}
