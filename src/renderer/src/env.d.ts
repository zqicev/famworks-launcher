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
    }
    mods: {
      installed: (modsDir: string) => Promise<string[]>
      toggle: (modsDir: string, filename: string, enabled: boolean) => Promise<void>
      delete: (modsDir: string, filename: string) => Promise<void>
      addFile: () => Promise<string | null>
    }
    modrinth: {
      search: (query: string, mcVersion: string, loader: string) => Promise<unknown[]>
      versions: (projectId: string, mcVersion: string, loader: string) => Promise<unknown[]>
      download: (url: string, filename: string, modsDir: string) => Promise<string>
    }
    install: {
      modpack: (id: string) => Promise<void>
      onProgress: (cb: (data: unknown) => void) => void
      onLog: (cb: (msg: string) => void) => void
    }
    launch: {
      start: (id: string) => Promise<void>
      onProgress: (cb: (data: unknown) => void) => void
      onLog: (cb: (msg: string) => void) => void
      onClose: (cb: (code: number) => void) => void
    }
    dialog: {
      pickFolder: () => Promise<string | null>
    }
    window: {
      minimize: () => void
      close: () => void
    }
  }
}
