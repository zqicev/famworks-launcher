/// <reference types="vite/client" />

interface Window {
  api: {
    store: {
      get: (key: string) => Promise<unknown>
      set: (key: string, value: unknown) => Promise<void>
    }
    modpacks: {
      index: () => Promise<import('../../types/modpack').ModpackIndex>
      get: (id: string) => Promise<import('../../types/modpack').Modpack>
      status: (id: string) => Promise<'not_installed' | 'outdated' | 'ready'>
      export: (id: string) => Promise<{ ok?: boolean; path?: string; cancelled?: boolean }>
      import: () => Promise<{ ok?: boolean; modpack?: import('../../types/modpack').Modpack; cancelled?: boolean }>
    }
    getPathForFile: (file: File) => string
    mods: {
      installed: (modsDir: string) => Promise<string[]>
      toggle: (modsDir: string, filename: string, enabled: boolean) => Promise<void>
      delete: (modsDir: string, filename: string) => Promise<void>
      addFile: (exts?: string[]) => Promise<string | null>
      fileSize: (modsDir: string, filename: string) => Promise<number>
      copyJar: (srcPath: string, modsDir: string) => Promise<string>
    }
    modrinth: {
      search: (query: string, mcVersion: string, loader: string, type?: string) => Promise<unknown[]>
      versions: (projectId: string, mcVersion: string, loader: string, type?: string) => Promise<unknown[]>
      download: (url: string, filename: string, modsDir: string, sha512?: string) => Promise<string>
    }
    curseforge: {
      search: (query: string, mcVersion: string, loader: string, type?: string) => Promise<unknown[]>
      files: (modId: number, mcVersion: string, loader: string, type?: string) => Promise<unknown[]>
      download: (url: string, filename: string, modsDir: string, sha1?: string) => Promise<string>
    }
    install: {
      modpack: (id: string) => Promise<boolean>
      onProgress: (cb: (data: unknown) => void) => () => void
    }
    cancel: () => Promise<void>
    killGame: () => Promise<boolean>
    gameRunning: () => Promise<string | null>
    busyGet: () => Promise<string | null>
    onBusyChanged: (cb: (id: string | null) => void) => () => void
    appVersion: () => Promise<string>
    loaderLatest: (loader: string, mc: string) => Promise<string>
    custom: {
      list: () => Promise<import('../../types/modpack').Modpack[]>
      save: (mp: import('../../types/modpack').Modpack) => Promise<boolean>
      delete: (id: string, deleteFiles: boolean) => Promise<boolean>
    }
    auth: {
      microsoftLogin: () => Promise<{ username: string; uuid: string; refreshToken: string; mclc: unknown }>
    }
    launch: {
      start: (id: string, quickPlay?: { type: 'singleplayer' | 'multiplayer'; identifier: string }) => Promise<boolean>
      onLog: (cb: (msg: string) => void) => () => void
      onClose: (cb: (code: number) => void) => () => void
      onError: (cb: (msg: string) => void) => () => void
      onSpawned: (cb: (id: string) => void) => () => void
    }
    dialog: {
      pickFolder: () => Promise<string | null>
    }
    shell: {
      openFolder: (path: string) => Promise<void>
    }
    system: {
      totalMemoryMb: () => Promise<number>
    }
    update: {
      install: () => Promise<void>
      check: () => Promise<boolean>
      onChecking: (cb: () => void) => () => void
      onAvailable: (cb: (info: { version: string }) => void) => () => void
      onNone: (cb: () => void) => () => void
      onProgress: (cb: (p: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => () => void
      onDownloaded: (cb: (info: { version: string }) => void) => () => void
      onError: (cb: (msg: string) => void) => () => void
    }
    recentGet: (id: string) => Promise<Array<
      | { kind: 'world'; folder: string; name: string; lastPlayed: number; mode: string; version: string; icon: string | null; score: number }
      | { kind: 'server'; name: string; ip: string; icon: string | null; score: number }
    >>
    serverPing: (ip: string) => Promise<{
      online: number
      max: number
      favicon: string | null
      ping: number
      motd: string
      version: string
    } | null>
    window: {
      minimize: () => void
      maximize: () => void
      close: () => void
    }
    taskbarProgress: (value: number, mode: 'none' | 'normal' | 'indeterminate') => void
  }
}
