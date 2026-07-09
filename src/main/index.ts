import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { setupIpcHandlers } from './ipc'
import { setupUpdater } from './updater'
import { initDiscord } from './discord'

function resolveIcon(): string | undefined {
  // В проде иконка лежит в resources (extraResources), в деве — в build/
  const candidates = [
    join(process.resourcesPath ?? '', 'icon.png'),
    join(__dirname, '../../build/icon.png')
  ]
  return candidates.find(p => existsSync(p))
}

/** Ищет путь к .fwpack среди аргументов запуска (ассоциация файла). */
function findFwpack(argv: string[]): string | null {
  return argv.find(a => typeof a === 'string' && a.toLowerCase().endsWith('.fwpack') && existsSync(a)) ?? null
}

/** Импортирует .fwpack и уведомляет рендерер (для ассоциации файлов / двойного клика). */
async function openFwpack(win: BrowserWindow, filePath: string): Promise<void> {
  try {
    const { importFromFile } = await import('./packio')
    const res = await importFromFile(filePath)
    if (res.ok && res.modpack) win.webContents.send('modpack:imported', { ok: true, modpack: res.modpack })
  } catch (e) {
    win.webContents.send('modpack:imported', { ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    backgroundColor: '#0a0a0a',
    icon: resolveIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.maximize() // по умолчанию открываем на весь экран
  return win
}

// Не даём запустить второй экземпляр — оба писали бы в один store и файлы игры.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      const file = findFwpack(argv)
      if (file) openFwpack(win, file)
    }
  })

  app.whenReady().then(() => {
    setupIpcHandlers()
    const win = createWindow()
    setupUpdater()
    initDiscord()

    // Открыт через двойной клик по .fwpack — импортируем после загрузки окна
    const pending = findFwpack(process.argv)
    if (pending) win.webContents.once('did-finish-load', () => openFwpack(win, pending))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
