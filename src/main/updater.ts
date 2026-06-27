import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow, ipcMain } from 'electron'

function send(channel: string, payload?: unknown) {
  const win = BrowserWindow.getAllWindows()[0]
  win?.webContents.send(channel, payload)
}

export function setupUpdater() {
  // Автообновление работает только в собранном приложении (нужен app-update.yml).
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true            // качаем обновление сразу как нашли
  autoUpdater.autoInstallOnAppQuit = true    // ставим при закрытии лаунчера
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => send('update:checking'))

  autoUpdater.on('update-available', (info) => {
    send('update:available', { version: info.version })
  })

  autoUpdater.on('update-not-available', () => send('update:none'))

  autoUpdater.on('download-progress', (p) => {
    send('update:progress', {
      percent: p.percent,
      bytesPerSecond: p.bytesPerSecond,
      transferred: p.transferred,
      total: p.total
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    send('update:downloaded', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    send('update:error', String(err?.message ?? err))
  })

  // Установить обновление сейчас (перезапуск)
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall()
  })

  // Ручная проверка из UI
  ipcMain.handle('update:check', async () => {
    try {
      await autoUpdater.checkForUpdates()
      return true
    } catch (e) {
      send('update:error', String(e))
      return false
    }
  })

  // Стартовая проверка (с небольшой задержкой, чтобы не мешать загрузке окна)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => send('update:error', String(e)))
  }, 4000)

  // Периодическая проверка раз в 30 минут (на случай долгой сессии)
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 30 * 60 * 1000)
}
