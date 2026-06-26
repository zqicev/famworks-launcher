import { Client, ILaunchOption } from 'minecraft-launcher-core'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { Modpack } from '../types/modpack'
import { ProgressEvent } from './installer'
import axios from 'axios'
import { mkdirSync, writeFileSync, existsSync } from 'fs'

const client = new Client()

function emit(win: BrowserWindow, event: ProgressEvent) {
  win.webContents.send('install:progress', event)
}

export async function installFabric(modpack: Modpack, gameRoot: string, win: BrowserWindow): Promise<string> {
  const versionId = `fabric-loader-${modpack.loader_version}-${modpack.mc_version}`
  const versionDir = join(gameRoot, 'versions', versionId)
  const versionFile = join(versionDir, `${versionId}.json`)

  if (!existsSync(versionFile)) {
    emit(win, { phase: 'download', message: 'Загрузка Fabric...' })
    const url = `https://meta.fabricmc.net/v2/versions/loader/${modpack.mc_version}/${modpack.loader_version}/profile/json`
    const res = await axios.get(url)
    mkdirSync(versionDir, { recursive: true })
    writeFileSync(versionFile, JSON.stringify(res.data, null, 2))
  }

  return versionId
}

export async function launchGame(
  modpack: Modpack,
  username: string,
  installPath: string,
  memoryMB: number,
  win: BrowserWindow
) {
  const gameRoot = join(installPath, modpack.id)
  const fabricVersionId = await installFabric(modpack, gameRoot, win)

  emit(win, { phase: 'download', message: 'Загрузка файлов Minecraft...' })

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
      type: 'release',
      custom: fabricVersionId
    },
    memory: {
      max: `${memoryMB}M`,
      min: '512M'
    },
    overrides: {
      detached: false
    }
  }

  client.on('debug', (e) => emit(win, { phase: 'download', message: String(e) }))
  client.on('data', (e) => emit(win, { phase: 'download', message: String(e) }))
  client.on('progress', (e) => {
    const p = e as { type: string; task: number; total: number }
    emit(win, {
      phase: 'download',
      message: `${p.type}`,
      current: p.task,
      total: p.total
    })
  })
  client.on('close', (code) => {
    win.webContents.send('launch:close', code)
    win.webContents.send('install:progress', { phase: 'done', message: '' })
  })

  await client.launch(options)
  emit(win, { phase: 'done', message: '' })
}

function generateOfflineUUID(username: string): string {
  let hash = 0
  for (let i = 0; i < username.length; i++) {
    hash = ((hash << 5) - hash) + username.charCodeAt(i)
    hash |= 0
  }
  const h = Math.abs(hash).toString(16).padStart(8, '0')
  return `${h.slice(0,8)}-${h.slice(0,4)}-3${h.slice(1,4)}-a${h.slice(2,5)}-${h.slice(0,12).padEnd(12,'0')}`
}
