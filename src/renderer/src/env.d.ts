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
    }
    mods: {
      installed: (modsDir: string) => Promise<string[]>
      toggle: (modsDir: string, filename: string, enabled: boolean) => Promise<void>
      delete: (modsDir: string, filename: string) => Promise<void>
      addFile: () => Promise<string | null>
      fileSize: (modsDir: string, filename: string) => Promise<number>
      copyJar: (srcPath: string, modsDir: string) => Promise<string>
    }
    modrinth: {
      search: (query: string, mcVersion: string, loader: string) => Promise<unknown[]>
      versions: (projectId: string, mcVersion: string, loader: string) => Promise<unknown[]>
      download: (url: string, filename: string, modsDir: string, sha512?: string) => Promise<string>
    }
    install: {
      modpack: (id: string) => Promise<boolean>
      onProgress: (cb: (data: unknown) => void) => () => void
    }
    cancel: () => Promise<void>
    gameRunning: () => Promise<string | null>
    appVersion: () => Promise<string>
    auth: {
      microsoftLogin: () => Promise<{ username: string; uuid: string; refreshToken: string; mclc: unknown }>
    }
    launch: {
      start: (id: string) => Promise<boolean>
      onLog: (cb: (msg: string) => void) => () => void
      onClose: (cb: (code: number) => void) => () => void
      onError: (cb: (msg: string) => void) => () => void
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
    window: {
      minimize: () => void
      close: () => void
    }
  }
}
