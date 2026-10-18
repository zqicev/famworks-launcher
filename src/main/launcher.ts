import { ILauncherOptions } from 'minecraft-launcher-core'
import { join } from 'path'
import { BrowserWindow, utilityProcess, UtilityProcess } from 'electron'
import { Modpack } from '../types/modpack'
import { ProgressEvent } from './installer'
import { setupLoader, requiredJavaMajor, loaderJvmArgs } from './loaders'
import { devLaunchOverrides } from './dev'
import { diagnoseCrash } from './crash'
import { ensureJava } from './java'
import { writeServers } from './servers'
import { isCancelError } from './abort'
import { setPlaying, setIdle } from './discord'
import { setBusy } from './busy'
import { addInstance, removeInstance, instancesForPack, anyInstances } from './instances'
import { packDir } from './packpaths'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { createHash, randomUUID } from 'crypto'

/** Безопасная отправка в окно лаунчера. Если окно уже закрыто (игра пережила лаунчер - это нормально),
 *  тихо пропускаем: иначе события завершающегося воркера падали бы с "Object has been destroyed". */
function sendTo(win: BrowserWindow, channel: string, payload: unknown): void {
  try {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send(channel, payload)
  } catch { /* окно закрылось между проверкой и отправкой */ }
}

function emit(win: BrowserWindow, event: ProgressEvent) {
  sendTo(win, 'install:progress', event)
}

/** true, если в пути есть не-ASCII символы (кириллица и т.п.). */
function hasNonAscii(p: string): boolean {
  return /[^\x00-\x7f]/.test(p)
}

/** На путях с кириллицей ранний loading-экран Forge (fmlearlydisplay) падает в драйвере GPU при
 *  glfwCreateWindow (EXCEPTION_ACCESS_VIOLATION в atio6axx.dll и т.п.). Отключаем его через
 *  config/fml.toml (earlyWindowControl=false) - сама игра запускается нормально, падает только этот
 *  ранний экран. Правим только одну строку, остальной конфиг не трогаем. */
function ensureForgeEarlyWindowOff(gameRoot: string, win: BrowserWindow, id: string): void {
  const cfgPath = join(gameRoot, 'config', 'fml.toml')
  const line = 'earlyWindowControl = false'
  try {
    let content = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : ''
    if (/^\s*earlyWindowControl\s*=/m.test(content)) {
      if (/^\s*earlyWindowControl\s*=\s*false\s*$/m.test(content)) return // уже отключён
      content = content.replace(/^\s*earlyWindowControl\s*=.*$/m, line)
    } else {
      content = content ? content.replace(/\s*$/, '') + '\n' + line + '\n' : line + '\n'
    }
    mkdirSync(join(gameRoot, 'config'), { recursive: true })
    writeFileSync(cfgPath, content)
    sendTo(win,'launch:log', { id, text: '[launcher] путь с кириллицей: ранний экран Forge отключён (earlyWindowControl=false), иначе краш в драйвере GPU' })
  } catch (e) {
    sendTo(win,'launch:log', { id, text: `[launcher] не удалось поправить config/fml.toml: ${String(e)}` })
  }
}

// Воркер запуска, который сейчас ГОТОВИТСЯ (до спавна) — для отмены скачивания ассетов (cancel).
// Запуски сериализованы через busy (пока идёт подготовка, новый запуск заблокирован), поэтому он один.
// После спавна экземпляр уходит в реестр (instances.ts), а prepWorker освобождается.
let prepWorker: UtilityProcess | null = null
let prepAborted = false

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
  accountName: string,
  quickPlay?: QuickPlay,
  authlibArgs: string[] = []
): Promise<void> {
  // Вкладку «Логи» чистим только для ПЕРВОГО экземпляра сборки — иначе 2-й запуск стёр бы логи 1-го
  // (у дублей одной сборки общий поток логов).
  if (instancesForPack(modpack.id).length === 0) sendTo(win,'launch:starting', modpack.id)

  // Dev-режим: отладка (JDWP) и hot-swap (JVM от JetBrains Runtime + enhanced redefinition)
  const dev = devLaunchOverrides(modpack.id)
  // Метки этапов в «Логи» — чтобы видеть, докуда дошёл запуск, даже если mclc молчит.
  const stage = (m: string): void => sendTo(win,'launch:log', { id: modpack.id, text: `[launcher] ${m}` })

  // 1. Java: hot-swap использует JBR; иначе гарантируем Java нужной мажорной версии (по версии MC)
  let javaPath: string
  if (dev.javaPath) {
    javaPath = dev.javaPath
  } else {
    stage('Проверка Java')
    try {
      javaPath = await ensureJava(installPath, win, await requiredJavaMajor(modpack.mc_version))
    } catch (e) {
      sendTo(win,'launch:error', `Не удалось установить Java: ${String(e)}`)
      return
    }
  }

  // 2. Загрузчик (Fabric/Quilt — meta-профиль, Forge/NeoForge — установщик). Все дают version-профиль.
  const gameRoot = packDir(modpack.id)
  stage('Подготовка загрузчика')
  const loaderVersionId = await setupLoader(modpack, gameRoot, win)
  // Кириллица в пути + Forge/NeoForge = краш в раннем экране Forge (драйвер GPU при glfwCreateWindow).
  // Отключаем ранний экран через config/fml.toml. Только для таких путей — у остальных он остаётся.
  if ((modpack.loader === 'forge' || modpack.loader === 'neoforge') && hasNonAscii(gameRoot)) {
    ensureForgeEarlyWindowOff(gameRoot, win, modpack.id)
  }
  // Forge/NeoForge держат module-path и прочие JVM-аргументы в профиле, а mclc их не читает —
  // передаём вручную через customArgs. Плюс dev-аргументы (отладка/hot-swap).
  const extraJvmArgs = [...loaderJvmArgs(modpack, gameRoot), ...dev.jvmArgs, ...authlibArgs]
  for (const n of dev.notes) sendTo(win,'launch:log', { id: modpack.id, text: n })

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
        sendTo(win,'launch:log', { id: modpack.id, text: `[servers] ${String(e)}` })
      }
    }
  }

  emit(win, { phase: 'download', message: 'Подготовка Minecraft...' })

  // 4. Предзагрузка ванильных ассетов в общий кэш (с прогрессом и лимитом параллельности).
  //    Пуленепробиваемо: любые ошибки/таймаут не блокируют запуск — mclc дотянет своё сам.
  stage('Проверка ресурсов Minecraft')
  try {
    const { ensureAssets } = await import('./assets')
    // assetId = имя, под которым mclc читает индекс: version.custom (профиль загрузчика) || версия MC
    const assetId = loaderVersionId || modpack.mc_version
    // Жёсткий предохранитель: даже если предзагрузка зависнет — не держим запуск дольше 3 минут.
    // clearTimeout обязателен, иначе после успешной предзагрузки таймер отклонит «ничей» промис (unhandled rejection).
    let assetsTimer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        ensureAssets(modpack.mc_version, installPath, win, assetId),
        new Promise((_, rej) => { assetsTimer = setTimeout(() => rej(new Error('assets-timeout')), 180000) })
      ])
    } finally {
      if (assetsTimer) clearTimeout(assetsTimer)
    }
  } catch (e) {
    if (isCancelError(e)) throw e // отмена пользователем — пробрасываем
    sendTo(win,'launch:log', { id: modpack.id, text: `[launcher] предзагрузка ресурсов пропущена: ${String(e)}` })
  }

  stage('Запуск Minecraft (mclc)')

  const options: ILauncherOptions = {
    authorization,
    root: gameRoot,
    // Vanilla: setupLoader вернул '' → custom не задаём, mclc запускает чистый клиент.
    version: { number: modpack.mc_version, type: 'release', ...(loaderVersionId ? { custom: loaderVersionId } : {}) },
    memory: { max: `${memoryMB}M`, min: '512M' },
    javaPath,
    // Общий кэш ванильных ассетов на все сборки — чтобы не перекачивать их для каждой сборки.
    overrides: { detached: true, assetRoot: join(installPath, 'assets') },
    ...(extraJvmArgs.length ? { customArgs: extraJvmArgs } : {}),
    ...(quickPlay ? { quickPlay: { type: quickPlay.type, identifier: quickPlay.identifier } } : {})
  } as ILauncherOptions

  const instanceId = randomUUID()
  prepAborted = false

  // mclc гоняем в отдельном процессе, чтобы можно было прервать скачивание ассетов
  await new Promise<void>((resolve, reject) => {
    const worker = utilityProcess.fork(join(__dirname, 'launchWorker.js'))
    prepWorker = worker
    let spawned = false
    let errored = false

    worker.on('message', (msg: any) => {
      if (msg.t === 'win') {
        // Логи игры помечаем id сборки, чтобы вкладка «Логи» показывала их по своей сборке
        if (msg.channel === 'launch:log') sendTo(win,'launch:log', { id: modpack.id, text: msg.payload })
        else sendTo(win,msg.channel, msg.payload)
      } else if (msg.t === 'spawned') {
        spawned = true
        prepWorker = null
        setBusy(null) // игра пошла — можно запускать ещё экземпляры / устанавливать другое
        addInstance({
          instanceId, modpackId: modpack.id, modpackName: modpack.name, account: accountName,
          pid: msg.pid, startedAt: Date.now(), worker, userKilled: false
        })
        emit(win, { phase: 'done', message: '' })
        sendTo(win,'launch:spawned', modpack.id)
        setPlaying(modpack.name)
        resolve()
      } else if (msg.t === 'close') {
        const inst = removeInstance(instanceId)
        // Диагностика краша — только если игра успела запуститься и её НЕ закрыл пользователь кнопкой.
        if (msg.code && spawned && !inst?.userKilled) {
          diagnoseCrash(modpack, gameRoot, msg.tail ?? '', inst?.startedAt ?? 0).catch(() => null).then(diag => {
            if (diag) sendTo(win,'crash:report', { modpackId: modpack.id, ...diag })
            else {
              const hint = pickErrorLine(msg.tail)
              sendTo(win,'launch:error', `Игра завершилась с ошибкой (код ${msg.code}).${hint ? ' ' + hint : ''}`)
            }
          })
        }
        sendTo(win,'launch:close', { modpackId: modpack.id, instanceId, code: msg.code })
        sendTo(win,'install:progress', { phase: 'done', message: '' })
        if (!anyInstances()) setIdle()
      } else if (msg.t === 'error') {
        errored = true
        prepWorker = null
        sendTo(win,'launch:error', `Не удалось запустить: ${msg.message}`)
        sendTo(win,'install:progress', { phase: 'done', message: '' })
        setBusy(null)
        reject(new Error(msg.message))
      }
    })

    worker.on('exit', () => {
      if (prepWorker === worker) prepWorker = null
      if (!spawned) {
        // воркер умер до запуска игры — отмена или сбой
        if (prepAborted) { reject(new DOMException('Aborted', 'AbortError')); return }
        if (!errored) {
          sendTo(win,'launch:error', 'Запуск прервался до старта игры. Смотрите вкладку «Логи».')
          sendTo(win,'install:progress', { phase: 'done', message: '' })
          setBusy(null)
        }
        resolve()
      }
    })

    worker.postMessage({ type: 'launch', options })
  })
}

/** Прерывает подготовку запуска (убивает готовящийся воркер), пока игра ещё не запущена. */
export function abortLaunch(): boolean {
  if (prepWorker) {
    prepAborted = true
    try { prepWorker.kill() } catch {}
    prepWorker = null
    setBusy(null)
    return true
  }
  return false
}

/** Выбирает информативную строку из хвоста лога упавшей игры (для сообщения пользователю). */
function pickErrorLine(tail?: string): string {
  if (!tail) return ''
  const lines = tail.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const key = /(Exception|Error|Caused by|Could not|Unable to|FATAL|failed|module)/i
  for (let i = lines.length - 1; i >= 0; i--) {
    if (key.test(lines[i])) return lines[i].slice(0, 300)
  }
  return lines[lines.length - 1]?.slice(0, 300) ?? ''
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
