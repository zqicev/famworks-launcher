import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

// Подписка с поддержкой нескольких слушателей и корректной отпиской.
// Возвращает функцию cleanup — компоненты вызывают её в useEffect cleanup.
function subscribe<T>(channel: string, cb: (data: T) => void): () => void {
  const handler = (_: IpcRendererEvent, data: T) => cb(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

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
    onProgress: (cb: (data: unknown) => void) => subscribe('install:progress', cb)
  },
  cancel: () => ipcRenderer.invoke('cancel'),
  auth: {
    microsoftLogin: () => ipcRenderer.invoke('auth:microsoft-login')
  },
  launch: {
    start: (id: string) => ipcRenderer.invoke('launch', id),
    onLog: (cb: (msg: string) => void) => subscribe('launch:log', cb),
    onClose: (cb: (code: number) => void) => subscribe('launch:close', cb),
    onError: (cb: (msg: string) => void) => subscribe('launch:error', cb)
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
  update: {
    install: () => ipcRenderer.invoke('update:install'),
    check: () => ipcRenderer.invoke('update:check'),
    onChecking: (cb: () => void) => subscribe('update:checking', cb),
    onAvailable: (cb: (info: { version: string }) => void) => subscribe('update:available', cb),
    onNone: (cb: () => void) => subscribe('update:none', cb),
    onProgress: (cb: (p: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) =>
      subscribe('update:progress', cb),
    onDownloaded: (cb: (info: { version: string }) => void) => subscribe('update:downloaded', cb),
    onError: (cb: (msg: string) => void) => subscribe('update:error', cb)
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close')
  }
})
