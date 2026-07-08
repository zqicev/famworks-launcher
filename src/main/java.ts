import { join } from 'path'
import { existsSync, mkdirSync, createWriteStream, readdirSync, statSync, rmSync, writeFileSync, renameSync } from 'fs'
import axios from 'axios'
import AdmZip from 'adm-zip'
import { execSync } from 'child_process'
import { BrowserWindow } from 'electron'
import { ProgressEvent } from './installer'
import { opSignal } from './abort'

function emit(win: BrowserWindow, event: ProgressEvent) {
  win.webContents.send('install:progress', event)
}

function platformInfo() {
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64'
  const isWin = process.platform === 'win32'
  return { os, arch, isWin }
}

/** Рекурсивно ищет bin/java(.exe) внутри распакованной JRE. */
function findJavaBin(dir: string): string | null {
  if (!existsSync(dir)) return null
  const exe = process.platform === 'win32' ? 'java.exe' : 'java'
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    let entries: string[]
    try { entries = readdirSync(cur) } catch { continue }
    for (const e of entries) {
      const full = join(cur, e)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) {
        stack.push(full)
      } else if (e === exe && cur.endsWith('bin')) {
        return full
      }
    }
  }
  return null
}

/** Проверяет что java по пути реально мажорной версии JAVA_MAJOR.
 *  ВАЖНО: `java -version` печатает в stderr, поэтому ловим оба потока через 2>&1. */
function javaVersionOk(javaPath: string, major: number): boolean {
  try {
    const out = execSync(`"${javaPath}" -version 2>&1`, { encoding: 'utf8', timeout: 5000 })
    const m = out.match(/version "(\d+)/)
    return !!m && parseInt(m[1], 10) === major
  } catch {
    return false
  }
}

/**
 * Гарантирует наличие JRE нужной версии в {installPath}/runtime.
 * Если нет — скачивает портативную сборку с Adoptium и распаковывает.
 * Возвращает путь к java.
 */
export async function ensureJava(installPath: string, win: BrowserWindow, major = 21): Promise<string> {
  const runtimeRoot = join(installPath, 'runtime')
  const javaDir = join(runtimeRoot, `jre-${major}`)
  const marker = join(javaDir, '.ready')

  // Быстрый путь: есть маркер успешной установки + бинарь на месте → доверяем без запуска java.
  const existing = findJavaBin(javaDir)
  if (existing && existsSync(marker)) return existing

  // Маркера нет, но бинарь есть и версия ок (например, обновились с прошлой версии лаунчера) —
  // ставим маркер и используем, без перекачивания.
  if (existing && javaVersionOk(existing, major)) {
    try { writeFileSync(marker, new Date().toISOString()) } catch {}
    return existing
  }

  // Битая/неполная распаковка — пробуем снести и переустановить.
  // Если файлы залочены (запущен Minecraft) — не падаем, а используем что есть.
  if (existsSync(javaDir)) {
    try {
      rmSync(javaDir, { recursive: true, force: true })
    } catch {
      if (existing) return existing
      throw new Error('Java занята другим процессом. Закройте Minecraft и попробуйте снова.')
    }
  }
  mkdirSync(javaDir, { recursive: true })

  const { os, arch, isWin } = platformInfo()
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${os}/${arch}/jre/hotspot/normal/eclipse`

  emit(win, { phase: 'download', message: `Загрузка Java ${major}...`, bytesDownloaded: 0, bytesTotal: 0, speedBps: 0 })

  const archivePath = join(runtimeRoot, isWin ? `jre-${major}.zip` : `jre-${major}.tar.gz`)
  await downloadFile(url, archivePath, (bytes, total, speed) => {
    emit(win, {
      phase: 'download',
      message: `Загрузка Java ${major}`,
      bytesDownloaded: bytes,
      bytesTotal: total,
      speedBps: speed
    })
  })

  emit(win, { phase: 'download', message: 'Распаковка Java...' })

  if (isWin) {
    const zip = new AdmZip(archivePath)
    zip.extractAllTo(javaDir, true)
  } else {
    // tar доступен на macOS, Linux и Windows 10+; здесь — для unix
    execSync(`tar -xzf "${archivePath}" -C "${javaDir}"`)
  }

  try { rmSync(archivePath, { force: true }) } catch {}

  const javaBin = findJavaBin(javaDir)
  if (!javaBin) throw new Error('Не удалось найти java после распаковки')

  // На unix снимаем флаг исполняемости (tar обычно сохраняет, adm-zip — нет)
  if (!isWin) {
    try { execSync(`chmod +x "${javaBin}"`) } catch {}
  }

  // Маркер успешной установки — больше не качаем при следующих запусках.
  try { writeFileSync(marker, new Date().toISOString()) } catch {}

  return javaBin
}

async function downloadFile(
  url: string,
  dest: string,
  onProgress: (bytes: number, total: number, speed: number) => void
) {
  const tmp = dest + '.tmp'
  const signal = opSignal()
  const res = await axios.get(url, { responseType: 'stream', maxRedirects: 5, signal })
  const total = parseInt(String(res.headers['content-length'] ?? '0'), 10)

  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(tmp)
    let downloaded = 0
    let lastTime = Date.now()
    let lastBytes = 0
    let settled = false

    const fail = (e: unknown) => {
      if (settled) return
      settled = true
      try { res.data.destroy() } catch {}
      try { stream.destroy() } catch {}
      try { rmSync(tmp, { force: true }) } catch {}
      reject(e)
    }
    const onAbort = () => fail(new DOMException('Aborted', 'AbortError'))
    if (signal) {
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
    }

    res.data.on('data', (chunk: Buffer) => {
      downloaded += chunk.length
      const now = Date.now()
      const elapsed = (now - lastTime) / 1000
      if (elapsed >= 0.3) {
        const speed = (downloaded - lastBytes) / elapsed
        lastTime = now
        lastBytes = downloaded
        onProgress(downloaded, total, speed)
      }
    })

    res.data.pipe(stream)
    stream.on('finish', () => { if (settled) return; settled = true; signal?.removeEventListener('abort', onAbort); resolve() })
    stream.on('error', fail)
    res.data.on('error', fail)
    res.data.on('aborted', () => fail(new DOMException('Aborted', 'AbortError')))
  })

  renameSync(tmp, dest)
}
