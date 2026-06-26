import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value)
  },
  modpacks: {
    index: () => ipcRenderer.invoke('modpacks:index'),
    get: (id: string) => ipcRenderer.invoke('modpacks:get', id)
  },
  mods: {
    installed: (modsDir: string) => ipcRenderer.invoke('mods:installed', modsDir),
    toggle: (modsDir: string, filename: string, enabled: boolean) =>
      ipcRenderer.invoke('mods:toggle', modsDir, filename, enabled),
    delete: (modsDir: string, filename: string) => ipcRenderer.invoke('mods:delete', modsDir, filename),
    addFile: () => ipcRenderer.invoke('mods:add-file')
  },
  modrinth: {
    search: (query: string, mcVersion: string, loader: string) =>
      ipcRenderer.invoke('modrinth:search', query, mcVersion, loader),
    versions: (projectId: string, mcVersion: string, loader: string) =>
      ipcRenderer.invoke('modrinth:versions', projectId, mcVersion, loader)
  },
  install: {
    modpack: (id: string) => ipcRenderer.invoke('install:modpack', id),
    onProgress: (cb: (data: unknown) => void) => ipcRenderer.on('install:progress', (_, d) => cb(d)),
    onLog: (cb: (msg: string) => void) => ipcRenderer.on('install:log', (_, m) => cb(m))
  },
  launch: {
    start: (id: string) => ipcRenderer.invoke('launch', id),
    onProgress: (cb: (data: unknown) => void) => ipcRenderer.on('launch:progress', (_, d) => cb(d)),
    onLog: (cb: (msg: string) => void) => ipcRenderer.on('launch:log', (_, m) => cb(m)),
    onClose: (cb: (code: number) => void) => ipcRenderer.on('launch:close', (_, c) => cb(c))
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke('dialog:pick-folder')
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close')
  }
})
