export interface ModpackSummary {
  id: string
  name: string
  description: string
  mc_version: string
  loader: 'fabric' | 'forge' | 'neoforge' | 'quilt'
  loader_version: string
  updated_at: string
}

export interface ModpackIndex {
  modpacks: ModpackSummary[]
}

export interface Mod {
  id: string
  name: string
  modrinth_id?: string
  curseforge_id?: number
  filename: string
  version: string
  category: string
  size_mb: number
  required: boolean
  download_url?: string
  sha512?: string
  sha1?: string
}

export interface ChangelogEntry {
  version: string
  description: string
}

export interface ServerEntry {
  name: string
  ip: string
  port?: number
}

export interface ConfigFile {
  path: string
  download_url: string
  sha512?: string
  overwrite?: boolean
}

export interface Modpack extends ModpackSummary {
  fabric_api_version: string
  long_description: string
  changelog: ChangelogEntry[]
  mods: Mod[]
  resourcepacks?: Mod[]
  shaders?: Mod[]
  servers?: ServerEntry[]
  configs?: ConfigFile[]
}

// Загруженная сборка вместе с git-sha файла (нужен для обновления через GitHub API)
export interface LoadedModpack {
  data: Modpack
  fileSha: string | null  // null = файла ещё нет (новая сборка)
}
