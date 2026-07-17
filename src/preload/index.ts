import { contextBridge, ipcRenderer } from 'electron'
import type { Modpack, LoadedModpack } from '../types/modpack'

contextBridge.exposeInMainWorld('api', {
  cfg: {
    get: (key: string) => ipcRenderer.invoke('cfg:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('cfg:set', key, value),
    validateToken: () => ipcRenderer.invoke('cfg:validate-token')
  },
  ws: {
    load: () => ipcRenderer.invoke('ws:load'),
    save: (modpack: Modpack, fileSha: string | null) => ipcRenderer.invoke('ws:save', modpack, fileSha),
    delete: (id: string, fileSha: string) => ipcRenderer.invoke('ws:delete', id, fileSha)
  },
  modrinth: {
    search: (q: string, mc: string, loader: string, type?: string) => ipcRenderer.invoke('modrinth:search', q, mc, loader, type),
    latest: (projectId: string, mc: string, loader: string, type?: string) => ipcRenderer.invoke('modrinth:latest', projectId, mc, loader, type),
    versions: (projectId: string, mc: string, loader: string, type?: string) => ipcRenderer.invoke('modrinth:versions', projectId, mc, loader, type)
  },
  cf: {
    validate: () => ipcRenderer.invoke('cf:validate'),
    search: (q: string, mc: string, loader: string, type?: string) => ipcRenderer.invoke('cf:search', q, mc, loader, type),
    files: (modId: number, mc: string, loader: string, type?: string) => ipcRenderer.invoke('cf:files', modId, mc, loader, type),
    resolve: (file: unknown) => ipcRenderer.invoke('cf:resolve', file)
  },
  jar: {
    pickAndUpload: () => ipcRenderer.invoke('jar:pick-and-upload')
  },
  config: {
    pickAndUpload: () => ipcRenderer.invoke('config:pick-and-upload')
  },
  rp: {
    pickAndUpload: () => ipcRenderer.invoke('rp:pick-and-upload')
  },
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    close: () => ipcRenderer.send('win:close')
  }
})

export type { Modpack, LoadedModpack }
