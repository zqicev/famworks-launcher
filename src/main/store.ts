import Store from 'electron-store'

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
}

export const store = new Store<StoreSchema>({
  defaults: {
    installPath: '',
    accounts: [],
    activeAccountId: null,
    allocatedMemory: 4096
  }
})
