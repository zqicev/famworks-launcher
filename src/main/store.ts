import Store from 'electron-store'

interface StoreSchema {
  token: string
  cfKey: string
  owner: string
  repo: string
  branch: string
  modsReleaseTag: string
  portalToken: string  // привязка к порталу FamWorks (код из профиля), для каталога модов
}

export const store = new Store<StoreSchema>({
  defaults: {
    token: '',
    cfKey: '',
    owner: 'zqicev',
    repo: 'famworks-builds',
    branch: 'main',
    modsReleaseTag: 'mods',
    portalToken: ''
  }
})
