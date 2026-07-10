import { ipcMain, dialog, BrowserWindow, shell, app } from 'electron'
import { copyFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { basename, join as pathJoin } from 'path'
import { spawn } from 'child_process'
import { setIdle } from './discord'
import { store } from './store'
import { fetchModpackIndex, fetchModpack } from './modpacks'
import { checkAndInstallModpack, getModpackStatus, toggleMod, deleteMod, getInstalledMods, downloadModToDir, getModFileSizeBytes } from './installer'
import { launchGame, offlineAuthorization, abortLaunch, markUserKill, QuickPlay } from './launcher'
import { setupLoader, latestLoaderVersion, LoaderId } from './loaders'
import { searchModrinth, getModVersions } from './modrinth'
import { microsoftLogin, microsoftRefresh } from './msAuth'
import { Account } from './store'
import { beginOperation, endOperation, cancelCurrent, isCancelError } from './abort'
import { setBusy, getBusyId, onBusyChange } from './busy'

function getWindow(): BrowserWindow {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

export function setupIpcHandlers() {
  onBusyChange((id) => getWindow()?.webContents.send('busy:changed', id))
  ipcMain.handle('busy:get', () => getBusyId())

  ipcMain.handle('store:get', (_, key) => store.get(key))
  ipcMain.handle('store:set', (_, key, value) => store.set(key, value))

  ipcMain.handle('modpacks:index', () => fetchModpackIndex())
  ipcMain.handle('modpacks:get', (_, id: string) => fetchModpack(id))

  ipcMain.handle('modpack:export', async (_, id: string) => {
    const { exportModpack } = await import('./packio')
    return exportModpack(id)
  })
  ipcMain.handle('modpack:import', async () => {
    const { importModpack } = await import('./packio')
    return importModpack()
  })

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

  // CurseForge через прокси-воркер (ключ не в клиенте)
  ipcMain.handle('cf:search', async (_, query: string, mc: string, loader: string, type?: string) => {
    const { searchCurseforge } = await import('./curseforge')
    return searchCurseforge(query, mc, loader, type)
  })
  ipcMain.handle('cf:files', async (_, modId: number, mc: string, loader: string, type?: string) => {
    const { getCurseforgeFiles } = await import('./curseforge')
    return getCurseforgeFiles(modId, mc, loader, type)
  })
  ipcMain.handle('cf:download', async (_, url: string, filename: string, modsDir: string, sha1?: string) => {
    await downloadModToDir(url, filename, modsDir, getWindow(), undefined, sha1)
    return filename
  })

  ipcMain.handle('install:modpack', async (_, modpackId: string) => {
    const win = getWindow()
    if (getBusyId() && getBusyId() !== modpackId) return false // занята другая сборка
    beginOperation()
    setBusy(modpackId)
    try {
      const modpack = await fetchModpack(modpackId)
      const installPath = store.get('installPath') as string
      const gameRoot = pathJoin(installPath, modpack.id)
      await setupLoader(modpack, gameRoot, win)
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
      setBusy(null)
    }
  })

  // Вход через Microsoft — открывает окно, возвращает данные аккаунта (рендерер их сохранит).
  ipcMain.handle('auth:microsoft-login', async () => {
    const res = await microsoftLogin()
    return res
  })

  ipcMain.handle('launch', async (_, modpackId: string, quickPlay?: QuickPlay) => {
    const win = getWindow()
    if (getBusyId() && getBusyId() !== modpackId) return false // занята другая сборка
    beginOperation()
    setBusy(modpackId)
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

      if (quickPlay) {
        const { recordPlay } = await import('./recent')
        recordPlay(modpackId, (quickPlay.type === 'singleplayer' ? 'w:' : 's:') + quickPlay.identifier)
      }

      // Скины по нику: у офлайн-аккаунта с галочкой подкидываем/убираем CustomSkinLoader
      try {
        const { ensureSkinMod } = await import('./skins')
        const wantSkins = account?.type === 'offline' && !!account.customSkins
        await ensureSkinMod(modpack, pathJoin(installPath, modpackId), wantSkins, win)
      } catch (e) {
        win.webContents.send('launch:log', { id: modpackId, text: `[skins] ${String(e)}` })
      }

      await launchGame(modpack, authorization, installPath, memory, win, quickPlay)
      return true
    } catch (e) {
      if (isCancelError(e)) {
        win.webContents.send('install:progress', { phase: 'cancelled', message: 'Отменено' })
        setBusy(null)
        return false
      }
      // Ошибка запуска (например, неодобренный MS-аккаунт) — показываем пользователю
      win.webContents.send('launch:error', e instanceof Error ? e.message : String(e))
      setBusy(null)
      return false
    } finally {
      endOperation()
    }
  })

  ipcMain.handle('cancel', () => {
    cancelCurrent()   // наши axios-загрузки (моды/Java/Fabric)
    abortLaunch()     // скачивание ассетов Minecraft (убиваем воркер mclc)
  })

  // Принудительно убить процесс запущенной игры
  ipcMain.handle('game:kill', () => {
    markUserKill() // не показываем диагностику краша — это пользователь закрыл
    cancelCurrent() // на случай, если ещё идёт скачивание перед запуском
    abortLaunch()
    const pid = store.get('runningPid') as number | null
    if (pid) {
      try {
        if (process.platform === 'win32') {
          // убиваем всё дерево процессов (java + дочерние)
          spawn('taskkill', ['/PID', String(pid), '/T', '/F'])
        } else {
          process.kill(pid, 'SIGKILL')
        }
      } catch { /* уже мёртв */ }
    }
    store.set('runningPid', null)
    store.set('runningModpackId', null)
    store.set('runningModpackName', null)
    setBusy(null)
    getWindow()?.webContents.send('launch:close', -1)
    setIdle()
    return true
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

  ipcMain.handle('recent:get', async (_, modpackId: string) => {
    const { getRecent } = await import('./recent')
    return getRecent(pathJoin(store.get('installPath') as string, modpackId), modpackId)
  })

  ipcMain.handle('server:ping', async (_, ip: string) => {
    const { pingServer } = await import('./mcping')
    return pingServer(ip)
  })

  // Режим разработчика
  ipcMain.handle('dev:get', async (_, id: string) => {
    const { getDevConfig } = await import('./dev')
    return getDevConfig(id)
  })
  ipcMain.handle('dev:set', async (_, id: string, partial: unknown) => {
    const { setDevConfig } = await import('./dev')
    return setDevConfig(id, partial as Record<string, unknown>)
  })
  ipcMain.handle('dev:pick-project', async () => {
    const { pickProject } = await import('./dev')
    return pickProject()
  })
  ipcMain.handle('dev:pick-idea', async () => {
    const { pickIdea } = await import('./dev')
    return pickIdea()
  })
  ipcMain.handle('dev:pick-jbr', async () => {
    const { pickJbr } = await import('./dev')
    return pickJbr()
  })
  ipcMain.handle('dev:open-intellij', async (_, id: string) => {
    const { openInIntelliJ } = await import('./dev')
    return openInIntelliJ(id)
  })
  ipcMain.handle('dev:run-config', async (_, id: string) => {
    const { createRunConfig } = await import('./dev')
    return createRunConfig(id)
  })
  ipcMain.handle('dev:build', async (_, id: string) => {
    const { buildProject } = await import('./dev')
    return buildProject(id)
  })
  ipcMain.handle('dev:sync-jar', async (_, id: string) => {
    const { syncJar } = await import('./dev')
    return syncJar(id)
  })
  ipcMain.handle('dev:watch', async (_, id: string, enable: boolean) => {
    const { setWatch } = await import('./dev')
    return setWatch(id, enable)
  })
  ipcMain.handle('dev:generate-mod', async (_, opts: unknown) => {
    const { generateMod } = await import('./dev')
    return generateMod(opts as { name: string; modId: string; loader: string; mcVersion: string; dest: string })
  })

  // Прогресс на иконке в панели задач. mode: none|normal|indeterminate
  ipcMain.on('taskbar:progress', (_, value: number, mode: 'none' | 'normal' | 'indeterminate') => {
    getWindow()?.setProgressBar(value, { mode })
  })

  // Последняя версия выбранного загрузчика под версию MC (для создания кастомной сборки)
  ipcMain.handle('loader:latest', (_, loader: LoaderId, mc: string) => latestLoaderVersion(loader, mc))

  // Кастомные (локальные) сборки
  ipcMain.handle('custom:list', () => store.get('customModpacks'))
  ipcMain.handle('custom:save', (_, mp) => {
    const list = (store.get('customModpacks') as any[]).filter(m => m.id !== mp.id)
    list.push(mp)
    store.set('customModpacks', list)
    // Сразу создаём структуру папок, чтобы «Открыть папку» и добавление файлов работали до установки
    try {
      const root = pathJoin(store.get('installPath') as string, mp.id)
      for (const sub of ['mods', 'resourcepacks', 'shaderpacks']) {
        mkdirSync(pathJoin(root, sub), { recursive: true })
      }
    } catch { /* installPath не задан — создастся позже при установке */ }
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

  ipcMain.handle('shell:open-folder', (_, folderPath: string) => {
    try { mkdirSync(folderPath, { recursive: true }) } catch { /* игнорируем */ }
    return shell.openPath(folderPath)
  })

  ipcMain.handle('crash:open-report', (_, filePath: string) => shell.openPath(filePath))
  ipcMain.handle('crash:fix', async (_, modpackId: string, fix: unknown) => {
    const { applyCrashFix } = await import('./crashfix')
    return applyCrashFix(modpackId, fix as { kind: string })
  })

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
  ipcMain.on('window:maximize', () => {
    const w = BrowserWindow.getFocusedWindow()
    if (w?.isMaximized()) w.unmaximize(); else w?.maximize()
  })
  ipcMain.on('window:close', () => BrowserWindow.getFocusedWindow()?.close())
}
