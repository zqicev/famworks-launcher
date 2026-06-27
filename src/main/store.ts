import Store from 'electron-store'

interface StoreSchema {
  token: string
  owner: string
  repo: string
  branch: string
  modsReleaseTag: string
}

export const store = new Store<StoreSchema>({
  defaults: {
    token: '',
    owner: 'zqicev',
    repo: 'famworks-builds',
    branch: 'main',
    modsReleaseTag: 'mods'
  }
})
