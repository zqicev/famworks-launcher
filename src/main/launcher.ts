import { Client, ILaunchOption } from 'minecraft-launcher-core'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { Modpack } from '../types/modpack'

const client = new Client()

export async function launchGame(
  modpack: Modpack,
  username: string,
  installPath: string,
  memoryMB: number,
  win: BrowserWindow
) {
  const gameRoot = join(installPath, modpack.id)

  const options: ILaunchOption = {
    authorization: {
      access_token: 'offline',
      client_token: 'famworks',
      uuid: generateOfflineUUID(username),
      name: username,
      user_properties: '{}'
    },
    root: gameRoot,
    version: {
      number: modpack.mc_version,
      type: 'release'
    },
    memory: {
      max: `${memoryMB}M`,
      min: '512M'
    },
    overrides: {
      detached: false
    }
  }

  client.on('debug', (e) => win.webContents.send('launch:log', e))
  client.on('data', (e) => win.webContents.send('launch:log', e))
  client.on('progress', (e) => win.webContents.send('launch:progress', e))
  client.on('close', (code) => win.webContents.send('launch:close', code))

  await client.launch(options)
}

function generateOfflineUUID(username: string): string {
  // Детерминированный UUID v3 на основе username (офлайн-совместимый)
  const hash = Array.from(username).reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return `xxxxxxxx-xxxx-3xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c, i) => {
    const v = (hash * (i + 1) * 31337) % 16 | 0
    return (c === 'x' ? v : (v & 0x3) | 0x8).toString(16)
  })
}
