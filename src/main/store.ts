import Store from 'electron-store'

interface StoreSchema {
  token: string
  cfKey: string
  owner: string
  repo: string
  branch: string
  modsReleaseTag: string
}

export const store = new Store<StoreSchema>({
  defaults: {
    token: '',
    cfKey: '',
    owner: 'zqicev',
    repo: 'famworks-builds',
    branch: 'main',
    modsReleaseTag: 'mods'
  }
})
