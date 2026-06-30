import { ipcMain, dialog, BrowserWindow } from 'electron'
import { store } from './store'
import { validateToken } from './github'
import { loadWorkspace, saveModpack, deleteModpack, uploadCustomJar, uploadConfig, uploadResourcepack } from './service'
import { searchModrinth, getLatestVersion } from './modrinth'
import { searchCurseforge, getCurseforgeFiles, validateCfKey, cfDownloadUrl, cfSha1, CfFile } from './curseforge'
import { Modpack } from '../types/modpack'

export function setupIpc() {
  // Настройки / токен
  ipcMain.handle('cfg:get', (_, key: string) => store.get(key))
  ipcMain.handle('cfg:set', (_, key: string, value: unknown) => store.set(key, value))
  ipcMain.handle('cfg:validate-token', async () => {
    try {
      const { login } = await validateToken()
      return { ok: true, login }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // Рабочее пространство
  ipcMain.handle('ws:load', () => loadWorkspace())
  ipcMain.handle('ws:save', (_, modpack: Modpack, fileSha: string | null) => saveModpack(modpack, fileSha))
  ipcMain.handle('ws:delete', (_, id: string, fileSha: string) => deleteModpack(id, fileSha))

  // Modrinth
  ipcMain.handle('modrinth:search', (_, q: string, mc: string, loader: string, type?: string) => searchModrinth(q, mc, loader, type))
  ipcMain.handle('modrinth:latest', (_, projectId: string, mc: string, loader: string, type?: string) =>
    getLatestVersion(projectId, mc, loader, type))

  // CurseForge
  ipcMain.handle('cf:validate', () => validateCfKey())
  ipcMain.handle('cf:search', (_, q: string, mc: string, loader: string, type?: string) => searchCurseforge(q, mc, loader, type))
  ipcMain.handle('cf:files', (_, modId: number, mc: string, loader: string, type?: string) => getCurseforgeFiles(modId, mc, loader, type))
  ipcMain.handle('cf:resolve', (_, file: CfFile) => ({ url: cfDownloadUrl(file), sha1: cfSha1(file) }))

  // Кастомный jar
  ipcMain.handle('jar:pick-and-upload', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Mod', extensions: ['jar'] }],
      properties: ['openFile']
    })
    if (!result.filePaths[0]) return null
    return uploadCustomJar(result.filePaths[0])
  })

  // Конфиг-файл (любой)
  ipcMain.handle('config:pick-and-upload', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'] })
    if (!result.filePaths[0]) return null
    return uploadConfig(result.filePaths[0])
  })

  // Ресурспак (.zip)
  ipcMain.handle('rp:pick-and-upload', async () => {
    const result = await dialog.showOpenDialog({ filters: [{ name: 'Resource pack', extensions: ['zip'] }], properties: ['openFile'] })
    if (!result.filePaths[0]) return null
    return uploadResourcepack(result.filePaths[0])
  })

  // Окно
  ipcMain.on('win:minimize', () => BrowserWindow.getFocusedWindow()?.minimize())
  ipcMain.on('win:close', () => BrowserWindow.getFocusedWindow()?.close())
}
