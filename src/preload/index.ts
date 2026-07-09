import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'

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
    status: (id: string) => ipcRenderer.invoke('modpack:status', id),
    export: (id: string) => ipcRenderer.invoke('modpack:export', id),
    import: () => ipcRenderer.invoke('modpack:import')
  },
  // В Electron 33+ File.path удалён — путь берём через webUtils
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  mods: {
    installed: (modsDir: string) => ipcRenderer.invoke('mods:installed', modsDir),
    toggle: (modsDir: string, filename: string, enabled: boolean) =>
      ipcRenderer.invoke('mods:toggle', modsDir, filename, enabled),
    delete: (modsDir: string, filename: string) => ipcRenderer.invoke('mods:delete', modsDir, filename),
    addFile: (exts?: string[]) => ipcRenderer.invoke('mods:add-file', exts),
    fileSize: (modsDir: string, filename: string) => ipcRenderer.invoke('mods:file-size', modsDir, filename),
    copyJar: (srcPath: string, modsDir: string) => ipcRenderer.invoke('mods:copy-jar', srcPath, modsDir)
  },
  modrinth: {
    search: (query: string, mcVersion: string, loader: string, type?: string) =>
      ipcRenderer.invoke('modrinth:search', query, mcVersion, loader, type),
    versions: (projectId: string, mcVersion: string, loader: string, type?: string) =>
      ipcRenderer.invoke('modrinth:versions', projectId, mcVersion, loader, type),
    download: (url: string, filename: string, modsDir: string, sha512?: string) =>
      ipcRenderer.invoke('modrinth:download', url, filename, modsDir, sha512)
  },
  curseforge: {
    search: (query: string, mcVersion: string, loader: string, type?: string) =>
      ipcRenderer.invoke('cf:search', query, mcVersion, loader, type),
    files: (modId: number, mcVersion: string, loader: string, type?: string) =>
      ipcRenderer.invoke('cf:files', modId, mcVersion, loader, type),
    download: (url: string, filename: string, modsDir: string, sha1?: string) =>
      ipcRenderer.invoke('cf:download', url, filename, modsDir, sha1)
  },
  install: {
    modpack: (id: string) => ipcRenderer.invoke('install:modpack', id),
    onProgress: (cb: (data: unknown) => void) => subscribe('install:progress', cb)
  },
  cancel: () => ipcRenderer.invoke('cancel'),
  killGame: () => ipcRenderer.invoke('game:kill'),
  gameRunning: () => ipcRenderer.invoke('game:running'),
  busyGet: () => ipcRenderer.invoke('busy:get'),
  onBusyChanged: (cb: (id: string | null) => void) => subscribe('busy:changed', cb),
  appVersion: () => ipcRenderer.invoke('app:version'),
  loaderLatest: (loader: string, mc: string) => ipcRenderer.invoke('loader:latest', loader, mc),
  custom: {
    list: () => ipcRenderer.invoke('custom:list'),
    save: (mp: unknown) => ipcRenderer.invoke('custom:save', mp),
    delete: (id: string, deleteFiles: boolean) => ipcRenderer.invoke('custom:delete', id, deleteFiles)
  },
  dev: {
    get: (id: string) => ipcRenderer.invoke('dev:get', id),
    set: (id: string, partial: unknown) => ipcRenderer.invoke('dev:set', id, partial),
    pickProject: () => ipcRenderer.invoke('dev:pick-project'),
    pickIdea: () => ipcRenderer.invoke('dev:pick-idea'),
    pickJbr: () => ipcRenderer.invoke('dev:pick-jbr'),
    openIntelliJ: (id: string) => ipcRenderer.invoke('dev:open-intellij', id),
    runConfig: (id: string) => ipcRenderer.invoke('dev:run-config', id),
    build: (id: string) => ipcRenderer.invoke('dev:build', id),
    syncJar: (id: string) => ipcRenderer.invoke('dev:sync-jar', id),
    watch: (id: string, enable: boolean) => ipcRenderer.invoke('dev:watch', id, enable),
    onSynced: (cb: (r: { id: string; filename: string }) => void) => subscribe('dev:synced', cb),
    generateMod: (opts: { name: string; modId: string; loader: string; mcVersion: string; dest: string }) =>
      ipcRenderer.invoke('dev:generate-mod', opts)
  },
  auth: {
    microsoftLogin: () => ipcRenderer.invoke('auth:microsoft-login')
  },
  launch: {
    start: (id: string, quickPlay?: unknown) => ipcRenderer.invoke('launch', id, quickPlay),
    onLog: (cb: (msg: { id: string; text: string }) => void) => subscribe('launch:log', cb),
    onClose: (cb: (code: number) => void) => subscribe('launch:close', cb),
    onError: (cb: (msg: string) => void) => subscribe('launch:error', cb),
    onSpawned: (cb: (id: string) => void) => subscribe('launch:spawned', cb)
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
  recentGet: (id: string) => ipcRenderer.invoke('recent:get', id),
  serverPing: (ip: string) => ipcRenderer.invoke('server:ping', ip),
  crash: {
    onReport: (cb: (d: unknown) => void) => subscribe('crash:report', cb),
    openReport: (path: string) => ipcRenderer.invoke('crash:open-report', path),
    applyFix: (modpackId: string, fix: unknown) => ipcRenderer.invoke('crash:fix', modpackId, fix)
  },
  // Импорт .fwpack по ассоциации файла (двойной клик) — main присылает результат
  onModpackImported: (cb: (res: { ok?: boolean; modpack?: unknown; error?: string }) => void) =>
    subscribe('modpack:imported', cb),
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close')
  },
  taskbarProgress: (value: number, mode: 'none' | 'normal' | 'indeterminate') =>
    ipcRenderer.send('taskbar:progress', value, mode)
})
