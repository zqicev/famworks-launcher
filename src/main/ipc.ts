import { ipcMain, dialog, BrowserWindow } from 'electron'
import { store } from './store'
import { fetchModpackIndex, fetchModpack } from './modpacks'
import { installModpack, toggleMod, deleteMod, getInstalledMods, downloadModToDir } from './installer'
import { launchGame } from './launcher'
import { searchModrinth, getModVersions } from './modrinth'
import { join } from 'path'

export function setupIpcHandlers() {
  // Store
  ipcMain.handle('store:get', (_, key) => store.get(key))
  ipcMain.handle('store:set', (_, key, value) => store.set(key, value))

  // Modpacks
  ipcMain.handle('modpacks:index', () => fetchModpackIndex())
  ipcMain.handle('modpacks:get', (_, id: string) => fetchModpack(id))

  // Mods
  ipcMain.handle('mods:installed', (_, modsDir: string) => getInstalledMods(modsDir))
  ipcMain.handle('mods:toggle', (_, modsDir: string, filename: string, enabled: boolean) =>
    toggleMod(modsDir, filename, enabled))
  ipcMain.handle('mods:delete', (_, modsDir: string, filename: string) =>
    deleteMod(modsDir, filename))
  ipcMain.handle('mods:add-file', async () => {
    const result = await dialog.showOpenDialog({ filters: [{ name: 'Mod', extensions: ['jar'] }], properties: ['openFile'] })
    return result.filePaths[0] ?? null
  })

  // Modrinth
  ipcMain.handle('modrinth:search', (_, query: string, mcVersion: string, loader: string) =>
    searchModrinth(query, mcVersion, loader))
  ipcMain.handle('modrinth:versions', (_, projectId: string, mcVersion: string, loader: string) =>
    getModVersions(projectId, mcVersion, loader))
  ipcMain.handle('modrinth:download', async (_, url: string, filename: string, modsDir: string) => {
    await downloadModToDir(url, filename, modsDir)
    return filename
  })

  // Install
  ipcMain.handle('install:modpack', async (_, modpackId: string) => {
    const win = BrowserWindow.getFocusedWindow()!
    const modpack = await fetchModpack(modpackId)
    const installPath = store.get('installPath')
    await installModpack(modpack, installPath, win)
    return true
  })

  // Launch
  ipcMain.handle('launch', async (_, modpackId: string) => {
    const win = BrowserWindow.getFocusedWindow()!
    const modpack = await fetchModpack(modpackId)
    const username = store.get('activeAccount') ?? 'Player'
    const installPath = store.get('installPath')
    const memory = store.get('allocatedMemory')
    await launchGame(modpack, username, installPath, memory, win)
    return true
  })

  // Path picker
  ipcMain.handle('dialog:pick-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.filePaths[0] ?? null
  })

  // Window controls
  ipcMain.on('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize())
  ipcMain.on('window:close', () => BrowserWindow.getFocusedWindow()?.close())
}
