export interface ModpackSummary {
  id: string
  name: string
  description: string
  mc_version: string
  loader: 'fabric' | 'forge'
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
  filename: string
  version: string
  category: string
  size_mb: number
  required: boolean
  download_url?: string
}

export interface ChangelogEntry {
  version: string
  description: string
}

export interface Modpack extends ModpackSummary {
  fabric_api_version: string
  long_description: string
  changelog: ChangelogEntry[]
  mods: Mod[]
}
