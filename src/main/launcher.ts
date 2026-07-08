import { ILauncherOptions } from 'minecraft-launcher-core'
import { join } from 'path'
import { BrowserWindow, utilityProcess, UtilityProcess } from 'electron'
import { Modpack } from '../types/modpack'
import { ProgressEvent } from './installer'
import { setupLoader, requiredJavaMajor } from './loaders'
import { ensureJava } from './java'
import { writeServers } from './servers'
import { setPlaying, setIdle } from './discord'
import { setBusy } from './busy'
import { store } from './store'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { createHash } from 'crypto'

function emit(win: BrowserWindow, event: ProgressEvent) {
  win.webContents.send('install:progress', event)
}

// Текущий процесс mclc (для отмены скачивания ассетов)
let currentWorker: UtilityProcess | null = null
let gameSpawned = false
let launchAborted = false

export interface QuickPlay {
  type: 'singleplayer' | 'multiplayer'
  identifier: string   // папка мира или host:port
}

export async function launchGame(
  modpack: Modpack,
  authorization: ILauncherOptions['authorization'],
  installPath: string,
  memoryMB: number,
  win: BrowserWindow,
  quickPlay?: QuickPlay
): Promise<void> {
  gameSpawned = false
  launchAborted = false

  // 1. Гарантируем Java нужной мажорной версии (зависит от версии MC)
  let javaPath: string
  try {
    javaPath = await ensureJava(installPath, win, requiredJavaMajor(modpack.mc_version))
  } catch (e) {
    win.webContents.send('launch:error', `Не удалось установить Java: ${String(e)}`)
    return
  }

  // 2. Загрузчик (Fabric/Quilt — профиль, Forge/NeoForge — installer)
  const gameRoot = join(installPath, modpack.id)
  const loaderSetup = await setupLoader(modpack, gameRoot, win)

  // 3. Серверы сборки → servers.dat. Сеем один раз: если набор серверов не менялся,
  //    повторно не трогаем (пользователь волен удалять/менять их у себя).
  if (modpack.servers?.length) {
    const key = JSON.stringify(modpack.servers.map(s => s.port && s.port !== 25565 ? `${s.ip}:${s.port}` : s.ip))
    const marker = join(gameRoot, '.fwservers')
    const prev = existsSync(marker) ? readFileSync(marker, 'utf8') : ''
    if (prev !== key) {
      try {
        await writeServers(gameRoot, modpack.servers)
        writeFileSync(marker, key)
      } catch (e) {
        win.webContents.send('launch:log', `[servers] ${String(e)}`)
      }
    }
  }

  emit(win, { phase: 'download', message: 'Подготовка Minecraft...' })

  const options: ILauncherOptions = {
    authorization,
    root: gameRoot,
    version: {
      number: modpack.mc_version,
      type: 'release',
      // Fabric/Quilt запускаются через custom-профиль; Forge/NeoForge — через options.forge
      ...(loaderSetup.kind === 'custom' ? { custom: loaderSetup.versionId } : {})
    },
    memory: { max: `${memoryMB}M`, min: '512M' },
    javaPath,
    overrides: { detached: true },
    ...(loaderSetup.kind === 'forge' ? { forge: loaderSetup.installerPath } : {}),
    ...(quickPlay ? { quickPlay: { type: quickPlay.type, identifier: quickPlay.identifier } } : {})
  } as ILauncherOptions

  // mclc гоняем в отдельном процессе, чтобы можно было прервать скачивание ассетов
  await new Promise<void>((resolve, reject) => {
    const worker = utilityProcess.fork(join(__dirname, 'launchWorker.js'))
    currentWorker = worker
    let spawned = false

    worker.on('message', (msg: any) => {
      if (msg.t === 'win') {
        win.webContents.send(msg.channel, msg.payload)
      } else if (msg.t === 'spawned') {
        spawned = true
        gameSpawned = true
        store.set('runningPid', msg.pid)
        store.set('runningModpackId', modpack.id)
        store.set('runningModpackName', modpack.name)
        emit(win, { phase: 'done', message: '' })
        win.webContents.send('launch:spawned', modpack.id)
        setPlaying(modpack.name)
        resolve()
      } else if (msg.t === 'close') {
        store.set('runningPid', null)
        store.set('runningModpackId', null)
        store.set('runningModpackName', null)
        setBusy(null)
        win.webContents.send('launch:close', msg.code)
        win.webContents.send('install:progress', { phase: 'done', message: '' })
        setIdle()
      } else if (msg.t === 'error') {
        reject(new Error(msg.message))
      }
    })

    worker.on('exit', () => {
      currentWorker = null
      if (!spawned) {
        // воркер умер до запуска игры — отмена или сбой
        if (launchAborted) reject(new DOMException('Aborted', 'AbortError'))
        else resolve()
      }
    })

    worker.postMessage({ type: 'launch', options })
  })
}

/** Прерывает скачивание ассетов (убивает воркер), пока игра ещё не запущена. */
export function abortLaunch(): boolean {
  if (currentWorker && !gameSpawned) {
    launchAborted = true
    try { currentWorker.kill() } catch {}
    currentWorker = null
    setBusy(null)
    return true
  }
  return false
}

export function offlineAuthorization(username: string): ILauncherOptions['authorization'] {
  return {
    access_token: 'offline',
    client_token: 'famworks',
    uuid: generateOfflineUUID(username),
    name: username,
    user_properties: {}
  }
}

function generateOfflineUUID(username: string): string {
  // Точная репликация Java UUID.nameUUIDFromBytes("OfflinePlayer:" + name) —
  // именно так vanilla Minecraft вычисляет UUID офлайн-игрока.
  const hash = createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest()
  hash[6] = (hash[6] & 0x0f) | 0x30 // версия 3
  hash[8] = (hash[8] & 0x3f) | 0x80 // вариант IETF
  const hex = hash.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}
