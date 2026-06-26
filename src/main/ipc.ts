import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { copyFileSync, mkdirSync } from 'fs'
import { basename, join as pathJoin } from 'path'
import { store } from './store'
import { fetchModpackIndex, fetchModpack } from './modpacks'
import { checkAndInstallModpack, getModpackStatus, toggleMod, deleteMod, getInstalledMods, downloadModToDir, getModFileSizeBytes } from './installer'
import { launchGame, installFabric } from './launcher'
import { searchModrinth, getModVersions } from './modrinth'

function getWindow(): BrowserWindow {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

export function setupIpcHandlers() {
  ipcMain.handle('store:get', (_, key) => store.get(key))
  ipcMain.handle('store:set', (_, key, value) => store.set(key, value))

  ipcMain.handle('modpacks:index', () => fetchModpackIndex())
  ipcMain.handle('modpacks:get', (_, id: string) => fetchModpack(id))

  ipcMain.handle('modpack:status', async (_, modpackId: string) => {
    const modpack = await fetchModpack(modpackId)
    const installPath = store.get('installPath') as string
    return getModpackStatus(modpack, installPath)
  })

  ipcMain.handle('mods:installed', (_, modsDir: string) => getInstalledMods(modsDir))
  ipcMain.handle('mods:toggle', (_, modsDir: string, filename: string, enabled: boolean) =>
    toggleMod(modsDir, filename, enabled))
  ipcMain.handle('mods:delete', (_, modsDir: string, filename: string) =>
    deleteMod(modsDir, filename))
  ipcMain.handle('mods:add-file', async () => {
    const result = await dialog.showOpenDialog({ filters: [{ name: 'Mod', extensions: ['jar'] }], properties: ['openFile'] })
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('modrinth:search', (_, query: string, mcVersion: string, loader: string) =>
    searchModrinth(query, mcVersion, loader))
  ipcMain.handle('modrinth:versions', (_, projectId: string, mcVersion: string, loader: string) =>
    getModVersions(projectId, mcVersion, loader))
  ipcMain.handle('modrinth:download', async (_, url: string, filename: string, modsDir: string) => {
    await downloadModToDir(url, filename, modsDir, getWindow())
    return filename
  })

  ipcMain.handle('install:modpack', async (_, modpackId: string) => {
    const win = getWindow()
    const modpack = await fetchModpack(modpackId)
    const installPath = store.get('installPath') as string
    const gameRoot = pathJoin(installPath, modpack.id)
    await installFabric(modpack, gameRoot, win)
    await checkAndInstallModpack(modpack, installPath, win)
    return true
  })

  ipcMain.handle('launch', async (_, modpackId: string) => {
    const win = getWindow()
    const modpack = await fetchModpack(modpackId)
    const username = store.get('activeAccount') as string ?? 'Player'
    const installPath = store.get('installPath') as string
    const memory = store.get('allocatedMemory') as number
    await launchGame(modpack, username, installPath, memory, win)
    return true
  })

  ipcMain.handle('dialog:pick-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('shell:open-folder', (_, folderPath: string) => shell.openPath(folderPath))

  ipcMain.handle('mods:file-size', (_, modsDir: string, filename: string) =>
    getModFileSizeBytes(modsDir, filename))

  ipcMain.handle('mods:copy-jar', (_, srcPath: string, modsDir: string) => {
    mkdirSync(modsDir, { recursive: true })
    const name = basename(srcPath)
    copyFileSync(srcPath, pathJoin(modsDir, name))
    return name
  })

  ipcMain.on('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize())
  ipcMain.on('window:close', () => BrowserWindow.getFocusedWindow()?.close())
}
