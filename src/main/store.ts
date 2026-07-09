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
  // Режим разработчика (инструменты мододела)
  devMode: boolean
  ideaPath: string // путь к idea64.exe для «Открыть в IntelliJ»
  jbrPath: string // путь к java.exe из JetBrains Runtime (для hot-swap); авто из IntelliJ, если пусто
  devSettings: Record<string, { debug?: boolean; port?: number; projectPath?: string; lastJar?: string; hotswap?: boolean }>
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
    playStats: {},
    devMode: false,
    ideaPath: '',
    jbrPath: '',
    devSettings: {}
  }
})
