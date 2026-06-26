import Store from 'electron-store'

interface Account {
  username: string
  type: 'minecraft'
}

interface StoreSchema {
  installPath: string
  accounts: Account[]
  activeAccount: string | null
  allocatedMemory: number
}

export const store = new Store<StoreSchema>({
  defaults: {
    installPath: '',
    accounts: [],
    activeAccount: null,
    allocatedMemory: 4096
  }
})
