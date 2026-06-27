import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value)
  },
  modpacks: {
    index: () => ipcRenderer.invoke('modpacks:index'),
    get: (id: string) => ipcRenderer.invoke('modpacks:get', id),
    status: (id: string) => ipcRenderer.invoke('modpack:status', id)
  },
  mods: {
    installed: (modsDir: string) => ipcRenderer.invoke('mods:installed', modsDir),
    toggle: (modsDir: string, filename: string, enabled: boolean) =>
      ipcRenderer.invoke('mods:toggle', modsDir, filename, enabled),
    delete: (modsDir: string, filename: string) => ipcRenderer.invoke('mods:delete', modsDir, filename),
    addFile: () => ipcRenderer.invoke('mods:add-file'),
    fileSize: (modsDir: string, filename: string) => ipcRenderer.invoke('mods:file-size', modsDir, filename),
    copyJar: (srcPath: string, modsDir: string) => ipcRenderer.invoke('mods:copy-jar', srcPath, modsDir)
  },
  modrinth: {
    search: (query: string, mcVersion: string, loader: string) =>
      ipcRenderer.invoke('modrinth:search', query, mcVersion, loader),
    versions: (projectId: string, mcVersion: string, loader: string) =>
      ipcRenderer.invoke('modrinth:versions', projectId, mcVersion, loader),
    download: (url: string, filename: string, modsDir: string) =>
      ipcRenderer.invoke('modrinth:download', url, filename, modsDir)
  },
  install: {
    modpack: (id: string) => ipcRenderer.invoke('install:modpack', id),
    onProgress: (cb: (data: unknown) => void) => {
      ipcRenderer.removeAllListeners('install:progress')
      ipcRenderer.on('install:progress', (_, d) => cb(d))
    }
  },
  cancel: () => ipcRenderer.invoke('cancel'),
  auth: {
    microsoftLogin: () => ipcRenderer.invoke('auth:microsoft-login')
  },
  launch: {
    start: (id: string) => ipcRenderer.invoke('launch', id),
    onLog: (cb: (msg: string) => void) => {
      ipcRenderer.removeAllListeners('launch:log')
      ipcRenderer.on('launch:log', (_, m) => cb(m))
    },
    onClose: (cb: (code: number) => void) => {
      ipcRenderer.removeAllListeners('launch:close')
      ipcRenderer.on('launch:close', (_, c) => cb(c))
    },
    onError: (cb: (msg: string) => void) => {
      ipcRenderer.removeAllListeners('launch:error')
      ipcRenderer.on('launch:error', (_, m) => cb(m))
    }
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke('dialog:pick-folder')
  },
  shell: {
    openFolder: (path: string) => ipcRenderer.invoke('shell:open-folder', path)
  },
  system: {
    totalMemoryMb: () => ipcRenderer.invoke('system:total-memory-mb')
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close')
  }
})
