import { ipcMain, dialog, BrowserWindow, shell, app } from 'electron'
import { copyFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { basename, join as pathJoin } from 'path'
import { store } from './store'
import { fetchModpackIndex, fetchModpack } from './modpacks'
import { checkAndInstallModpack, getModpackStatus, toggleMod, deleteMod, getInstalledMods, downloadModToDir, getModFileSizeBytes } from './installer'
import { launchGame, installFabric, offlineAuthorization } from './launcher'
import { searchModrinth, getModVersions } from './modrinth'
import { microsoftLogin, microsoftRefresh } from './msAuth'
import { Account } from './store'
import { beginOperation, endOperation, cancelCurrent, isCancelError } from './abort'

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
  ipcMain.handle('mods:add-file', async (_, exts?: string[]) => {
    const extensions = exts && exts.length ? exts : ['jar']
    const result = await dialog.showOpenDialog({ filters: [{ name: 'File', extensions }], properties: ['openFile'] })
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('modrinth:search', (_, query: string, mcVersion: string, loader: string, type?: string) =>
    searchModrinth(query, mcVersion, loader, type))
  ipcMain.handle('modrinth:versions', (_, projectId: string, mcVersion: string, loader: string, type?: string) =>
    getModVersions(projectId, mcVersion, loader, type))
  ipcMain.handle('modrinth:download', async (_, url: string, filename: string, modsDir: string, sha512?: string) => {
    await downloadModToDir(url, filename, modsDir, getWindow(), sha512)
    return filename
  })

  ipcMain.handle('install:modpack', async (_, modpackId: string) => {
    const win = getWindow()
    beginOperation()
    try {
      const modpack = await fetchModpack(modpackId)
      const installPath = store.get('installPath') as string
      const gameRoot = pathJoin(installPath, modpack.id)
      await installFabric(modpack, gameRoot, win)
      await checkAndInstallModpack(modpack, installPath, win)
      return true
    } catch (e) {
      if (isCancelError(e)) {
        win.webContents.send('install:progress', { phase: 'cancelled', message: 'Отменено' })
        return false
      }
      throw e
    } finally {
      endOperation()
    }
  })

  // Вход через Microsoft — открывает окно, возвращает данные аккаунта (рендерер их сохранит).
  ipcMain.handle('auth:microsoft-login', async () => {
    const res = await microsoftLogin()
    return res
  })

  ipcMain.handle('launch', async (_, modpackId: string) => {
    const win = getWindow()
    beginOperation()
    try {
      const modpack = await fetchModpack(modpackId)
      const installPath = store.get('installPath') as string
      const memory = store.get('allocatedMemory') as number

      const accounts = store.get('accounts') as Account[]
      const activeId = store.get('activeAccountId') as string | null
      const account = accounts.find(a => a.id === activeId) ?? accounts[0]

      let authorization
      if (account?.type === 'microsoft' && account.refreshToken) {
        // Обновляем токен перед запуском (Minecraft-токен живёт ~24ч)
        const res = await microsoftRefresh(account.refreshToken)
        // Сохраняем свежий refresh-токен
        const updated = accounts.map(a => a.id === account.id
          ? { ...a, username: res.username, uuid: res.uuid, refreshToken: res.refreshToken }
          : a)
        store.set('accounts', updated)
        authorization = {
          access_token: res.mclc.access_token,
          client_token: res.mclc.client_token ?? 'famworks',
          uuid: res.mclc.uuid,
          name: res.mclc.name ?? res.username,
          user_properties: res.mclc.user_properties ?? {},
          meta: res.mclc.meta as { type: 'mojang' | 'msa'; demo?: boolean } | undefined
        }
      } else {
        authorization = offlineAuthorization(account?.username ?? 'Player')
      }

      await launchGame(modpack, authorization, installPath, memory, win)
      return true
    } catch (e) {
      if (isCancelError(e)) {
        win.webContents.send('install:progress', { phase: 'cancelled', message: 'Отменено' })
        return false
      }
      // Ошибка запуска (например, неодобренный MS-аккаунт) — показываем пользователю
      win.webContents.send('launch:error', e instanceof Error ? e.message : String(e))
      return false
    } finally {
      endOperation()
    }
  })

  ipcMain.handle('cancel', () => {
    cancelCurrent()
  })

  // Какая сборка сейчас запущена (переживает перезапуск лаунчера через сохранённый PID)
  ipcMain.handle('game:running', () => {
    const pid = store.get('runningPid') as number | null
    const id = store.get('runningModpackId') as string | null
    if (!pid || !id) return null
    try {
      process.kill(pid, 0) // не убивает, только проверяет существование
      return id
    } catch {
      store.set('runningPid', null)
      store.set('runningModpackId', null)
      return null
    }
  })

  ipcMain.handle('dialog:pick-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('app:version', () => app.getVersion())

  // Прогресс на иконке в панели задач. mode: none|normal|indeterminate
  ipcMain.on('taskbar:progress', (_, value: number, mode: 'none' | 'normal' | 'indeterminate') => {
    getWindow()?.setProgressBar(value, { mode })
  })

  // Последняя стабильная версия Fabric-загрузчика для версии MC (для создания кастомной сборки)
  ipcMain.handle('fabric:loader', async (_, mc: string) => {
    try {
      const axios = (await import('axios')).default
      const res = await axios.get(`https://meta.fabricmc.net/v2/versions/loader/${mc}`, { timeout: 8000 })
      const stable = (res.data as any[]).find(v => v.loader?.stable) ?? res.data[0]
      return stable?.loader?.version ?? ''
    } catch { return '' }
  })

  // Кастомные (локальные) сборки
  ipcMain.handle('custom:list', () => store.get('customModpacks'))
  ipcMain.handle('custom:save', (_, mp) => {
    const list = (store.get('customModpacks') as any[]).filter(m => m.id !== mp.id)
    list.push(mp)
    store.set('customModpacks', list)
    return true
  })
  ipcMain.handle('custom:delete', (_, id: string, deleteFiles: boolean) => {
    store.set('customModpacks', (store.get('customModpacks') as any[]).filter(m => m.id !== id))
    if (deleteFiles) {
      const dir = pathJoin(store.get('installPath') as string, id)
      if (existsSync(dir)) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
    }
    return true
  })

  ipcMain.handle('shell:open-folder', (_, folderPath: string) => shell.openPath(folderPath))

  ipcMain.handle('system:total-memory-mb', async () => {
    const os = await import('os')
    return Math.round(os.totalmem() / 1024 / 1024)
  })

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
