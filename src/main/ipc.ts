import { ipcMain, dialog, BrowserWindow } from 'electron'
import { store } from './store'
import { validateToken } from './github'
import { loadWorkspace, saveModpack, deleteModpack, uploadCustomJar, uploadConfig } from './service'
import { searchModrinth, getLatestVersion } from './modrinth'
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
  ipcMain.handle('modrinth:search', (_, q: string, mc: string, loader: string) => searchModrinth(q, mc, loader))
  ipcMain.handle('modrinth:latest', (_, projectId: string, mc: string, loader: string) =>
    getLatestVersion(projectId, mc, loader))

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

  // Окно
  ipcMain.on('win:minimize', () => BrowserWindow.getFocusedWindow()?.minimize())
  ipcMain.on('win:close', () => BrowserWindow.getFocusedWindow()?.close())
}
