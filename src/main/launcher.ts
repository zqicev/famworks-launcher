import { Client, ILauncherOptions } from 'minecraft-launcher-core'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { Modpack } from '../types/modpack'
import { ProgressEvent } from './installer'
import { ensureJava } from './java'
import { opSignal } from './abort'
import axios from 'axios'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { createHash } from 'crypto'

function emit(win: BrowserWindow, event: ProgressEvent) {
  win.webContents.send('install:progress', event)
}

// Человеческие подписи для типов прогресса mclc
const PROGRESS_LABELS: Record<string, string> = {
  assets: 'Скачивание ресурсов',
  'assets-copy': 'Копирование ресурсов',
  natives: 'Нативные библиотеки',
  classes: 'Библиотеки',
  'classes-custom': 'Библиотеки Fabric',
  'classes-maven-custom': 'Библиотеки Fabric',
  'version-jar': 'Клиент Minecraft'
}

export async function installFabric(modpack: Modpack, gameRoot: string, win: BrowserWindow): Promise<string> {
  const versionId = `fabric-loader-${modpack.loader_version}-${modpack.mc_version}`
  const versionDir = join(gameRoot, 'versions', versionId)
  const versionFile = join(versionDir, `${versionId}.json`)

  if (!existsSync(versionFile)) {
    emit(win, { phase: 'download', message: 'Загрузка Fabric...' })
    const url = `https://meta.fabricmc.net/v2/versions/loader/${modpack.mc_version}/${modpack.loader_version}/profile/json`
    const res = await axios.get(url, { timeout: 10000, signal: opSignal() })
    mkdirSync(versionDir, { recursive: true })
    writeFileSync(versionFile, JSON.stringify(res.data, null, 2))
  }

  return versionId
}

export async function launchGame(
  modpack: Modpack,
  authorization: ILauncherOptions['authorization'],
  installPath: string,
  memoryMB: number,
  win: BrowserWindow
): Promise<void> {
  // 1. Гарантируем Java (скачиваем если надо)
  let javaPath: string
  try {
    javaPath = await ensureJava(installPath, win)
  } catch (e) {
    win.webContents.send('launch:error', `Не удалось установить Java: ${String(e)}`)
    return
  }

  // 2. Fabric-профиль
  const gameRoot = join(installPath, modpack.id)
  const fabricVersionId = await installFabric(modpack, gameRoot, win)

  emit(win, { phase: 'download', message: 'Подготовка Minecraft...' })

  const client = new Client()

  const options: ILauncherOptions = {
    authorization,
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
    javaPath,
    overrides: {
      detached: true
    }
  }

  // Текущий этап (по типу из 'progress') + байты (из 'download-status')
  let currentLabel = 'Загрузка файлов'
  let lastBytesTime = Date.now()
  let lastBytes = 0
  let lastSpeed = 0

  client.on('progress', (e) => {
    const p = e as { type: string; task: number; total: number }
    currentLabel = PROGRESS_LABELS[p.type] ?? p.type
    emit(win, {
      phase: 'download',
      message: currentLabel,
      current: p.task,
      total: p.total
    })
  })

  client.on('download-status', (e) => {
    const d = e as { name: string; type: string; current: number; total: number }
    const now = Date.now()
    const elapsed = (now - lastBytesTime) / 1000
    if (elapsed >= 0.3) {
      lastSpeed = (d.current - lastBytes) / elapsed
      lastBytesTime = now
      lastBytes = d.current
    }
    emit(win, {
      phase: 'download',
      message: currentLabel,
      bytesDownloaded: d.current,
      bytesTotal: d.total,
      speedBps: lastSpeed > 0 ? lastSpeed : undefined
    })
  })

  client.on('data', (data) => {
    win.webContents.send('launch:log', String(data))
  })

  await new Promise<void>((resolve, reject) => {
    client.on('close', (code) => {
      win.webContents.send('launch:close', code)
      win.webContents.send('install:progress', { phase: 'done', message: '' })
    })

    client.launch(options).then(() => {
      emit(win, { phase: 'done', message: '' })
      resolve()
    }).catch(reject)
  })
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
