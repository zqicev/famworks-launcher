import { Client, ILaunchOption } from 'minecraft-launcher-core'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { Modpack } from '../types/modpack'
import { ProgressEvent } from './installer'
import axios from 'axios'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'

function emit(win: BrowserWindow, event: ProgressEvent) {
  win.webContents.send('install:progress', event)
}

function findJava(): string | null {
  try {
    const out = execSync('java -version 2>&1', { encoding: 'utf8', timeout: 3000 })
    return 'java'
  } catch {
    // Попробуем JAVA_HOME
    const javaHome = process.env.JAVA_HOME
    if (javaHome) {
      const bin = join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
      if (existsSync(bin)) return bin
    }
    return null
  }
}

export async function installFabric(modpack: Modpack, gameRoot: string, win: BrowserWindow): Promise<string> {
  const versionId = `fabric-loader-${modpack.loader_version}-${modpack.mc_version}`
  const versionDir = join(gameRoot, 'versions', versionId)
  const versionFile = join(versionDir, `${versionId}.json`)

  if (!existsSync(versionFile)) {
    emit(win, { phase: 'download', message: 'Загрузка Fabric...' })
    const url = `https://meta.fabricmc.net/v2/versions/loader/${modpack.mc_version}/${modpack.loader_version}/profile/json`
    const res = await axios.get(url, { timeout: 10000 })
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
): Promise<void> {
  const java = findJava()
  if (!java) {
    win.webContents.send('launch:error', 'Java не найдена. Установите Java 17+ и перезапустите лаунчер.')
    return
  }

  const gameRoot = join(installPath, modpack.id)
  const fabricVersionId = await installFabric(modpack, gameRoot, win)

  emit(win, { phase: 'download', message: 'Запуск Minecraft...' })

  const client = new Client()

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
    javaPath: java,
    overrides: {
      detached: true
    }
  }

  client.on('progress', (e) => {
    const p = e as { type: string; task: number; total: number }
    emit(win, {
      phase: 'download',
      message: `${p.type}`,
      current: p.task,
      total: p.total
    })
  })

  client.on('data', (data) => {
    // Логи JVM — шлём как лог, не как прогресс
    win.webContents.send('launch:log', String(data))
  })

  // Ждём запуска процесса, потом сообщаем что игра запущена
  await new Promise<void>((resolve, reject) => {
    client.on('close', (code) => {
      win.webContents.send('launch:close', code)
      win.webContents.send('install:progress', { phase: 'done', message: '' })
    })

    client.launch(options).then(() => {
      // launch() резолвится когда процесс стартовал (не закрылся)
      emit(win, { phase: 'done', message: '' })
      resolve()
    }).catch(reject)
  })
}

function generateOfflineUUID(username: string): string {
  let hash = 0
  for (let i = 0; i < username.length; i++) {
    hash = ((hash << 5) - hash) + username.charCodeAt(i)
    hash |= 0
  }
  const h = Math.abs(hash).toString(16).padStart(12, '0')
  return `${h.slice(0,8)}-${h.slice(0,4)}-3${h.slice(4,8)}-a${h.slice(4,8)}-${h.slice(0,12)}`
}
