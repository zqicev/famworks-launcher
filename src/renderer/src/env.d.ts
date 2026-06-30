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
interface CfHit { id: number; name: string; summary: string; downloadCount: number; authors: { name: string }[] }
interface CfFile { id: number; fileName: string; displayName: string; downloadUrl: string | null; fileLength: number; hashes: { value: string; algo: number }[]; gameVersions: string[] }
interface ConfigUpload { filename: string; download_url: string; sha512: string; suggestedPath: string }

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
        search: (q: string, mc: string, loader: string, type?: string) => Promise<ModrinthHit[]>
        latest: (projectId: string, mc: string, loader: string, type?: string) => Promise<ModrinthVersion | null>
      }
      cf: {
        validate: () => Promise<boolean>
        search: (q: string, mc: string, loader: string, type?: string) => Promise<CfHit[]>
        files: (modId: number, mc: string, loader: string, type?: string) => Promise<CfFile[]>
        resolve: (file: CfFile) => Promise<{ url: string; sha1?: string }>
      }
      jar: { pickAndUpload: () => Promise<JarUpload | null> }
      config: { pickAndUpload: () => Promise<ConfigUpload | null> }
      rp: { pickAndUpload: () => Promise<JarUpload | null> }
      win: { minimize: () => void; close: () => void }
    }
  }
}

export {}
