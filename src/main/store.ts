import Store from 'electron-store'
import { Modpack } from '../types/modpack'

export interface Account {
  id: string                    // 'offline:<ник>' или 'msa:<uuid>'
  username: string
  type: 'offline' | 'microsoft'
  uuid?: string                 // для microsoft
  refreshToken?: string         // для microsoft
}

interface StoreSchema {
  installPath: string
  accounts: Account[]
  activeAccountId: string | null
  allocatedMemory: number
  runningPid: number | null
  runningModpackId: string | null
  runningModpackName: string | null
  customModpacks: Modpack[]
  // Статистика запусков миров/серверов для сортировки «Продолжить игру»:
  // { [modpackId]: { 'w:<folder>' | 's:<ip>': { count, last } } }
  playStats: Record<string, Record<string, { count: number; last: number }>>
}

export const store = new Store<StoreSchema>({
  defaults: {
    installPath: '',
    accounts: [],
    activeAccountId: null,
    allocatedMemory: 4096,
    runningPid: null,
    runningModpackId: null,
    runningModpackName: null,
    customModpacks: [],
    playStats: {}
  }
})
