import { dialog, shell, BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, copyFileSync, rmSync, watch, FSWatcher } from 'fs'
import { store } from './store'

interface DevSetting { debug?: boolean; port?: number; projectPath?: string; lastJar?: string }
export interface DevConfig { debug: boolean; port: number; projectPath: string; ideaPath: string; watching: boolean }

function emit(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send(channel, payload)
}

function getMap(): Record<string, DevSetting> {
  return (store.get('devSettings') as Record<string, DevSetting>) || {}
}

export function getDevConfig(id: string): DevConfig {
  const s = getMap()[id] || {}
  return {
    debug: !!s.debug,
    port: s.port || 5005,
    projectPath: s.projectPath || '',
    ideaPath: (store.get('ideaPath') as string) || '',
    watching: watchers.has(id)
  }
}

function modsDir(id: string): string {
  return join(store.get('installPath') as string, id, 'mods')
}

function setLastJar(id: string, filename: string): void {
  const map = { ...getMap() }
  map[id] = { ...(map[id] || {}), lastJar: filename }
  store.set('devSettings', map)
}

/** Самый свежий собранный jar мода в build/libs (без sources/dev/javadoc). */
function findModJar(projectPath: string): string | null {
  const libs = join(projectPath, 'build', 'libs')
  if (!existsSync(libs)) return null
  const cand = readdirSync(libs)
    .filter(f => f.endsWith('.jar') && !/-(sources|dev|javadoc|slim|dev-shadow)\.jar$/i.test(f))
    .map(f => ({ f, m: statSync(join(libs, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
  return cand[0] ? join(libs, cand[0].f) : null
}

/** Копирует свежий jar мода в моды сборки, удаляя ранее скопированную версию. */
export function syncJar(id: string): { ok: boolean; filename?: string; error?: string } {
  const cfg = getDevConfig(id)
  if (!cfg.projectPath) return { ok: false, error: 'Не указана папка проекта' }
  const jar = findModJar(cfg.projectPath)
  if (!jar) return { ok: false, error: 'Не найден jar в build/libs — сначала соберите мод' }
  const dir = modsDir(id)
  mkdirSync(dir, { recursive: true })
  const prev = getMap()[id]?.lastJar
  if (prev && prev !== jar.split(/[\\/]/).pop()) {
    try { rmSync(join(dir, prev), { force: true }) } catch { /* ignore */ }
  }
  const filename = jar.split(/[\\/]/).pop() as string
  copyFileSync(jar, join(dir, filename))
  setLastJar(id, filename)
  return { ok: true, filename }
}

/** Запускает gradlew build, стримит вывод в «Логи» (помечено id сборки). */
export function buildProject(id: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise(resolve => {
    const cfg = getDevConfig(id)
    if (!cfg.projectPath) return resolve({ ok: false, error: 'Не указана папка проекта' })
    const isWin = process.platform === 'win32'
    const gradlew = join(cfg.projectPath, isWin ? 'gradlew.bat' : 'gradlew')
    if (!existsSync(gradlew)) return resolve({ ok: false, error: 'В проекте нет gradlew — это Gradle-проект мода?' })

    emit('launch:log', { id, text: '[gradle] Сборка мода…' })
    const proc = spawn(gradlew, ['build', '-x', 'test'], { cwd: cfg.projectPath, shell: isWin })
    let tail = ''
    const onData = (d: Buffer): void => {
      const s = d.toString()
      tail = (tail + s).slice(-1200)
      for (const l of s.split(/\r?\n/)) if (l) emit('launch:log', { id, text: '[gradle] ' + l })
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('error', e => resolve({ ok: false, error: String(e) }))
    proc.on('close', code => resolve(code === 0 ? { ok: true } : { ok: false, error: `gradle: код ${code}. ${tail.slice(-160)}` }))
  })
}

const watchers = new Map<string, { w: FSWatcher; t?: ReturnType<typeof setTimeout> }>()

/** Включает/выключает авто-синхронизацию jar при изменении build/libs. */
export function setWatch(id: string, enable: boolean): { ok: boolean; watching: boolean; error?: string } {
  const cur = watchers.get(id)
  if (cur) { try { cur.w.close() } catch { /* ignore */ } watchers.delete(id) }
  if (!enable) return { ok: true, watching: false }
  const cfg = getDevConfig(id)
  if (!cfg.projectPath) return { ok: false, watching: false, error: 'Не указана папка проекта' }
  const libs = join(cfg.projectPath, 'build', 'libs')
  try {
    mkdirSync(libs, { recursive: true }) // чтобы watch не падал до первой сборки
    const w = watch(libs, () => {
      const e = watchers.get(id)
      if (!e) return
      if (e.t) clearTimeout(e.t)
      e.t = setTimeout(() => { const r = syncJar(id); if (r.ok) emit('dev:synced', { id, filename: r.filename }) }, 400)
    })
    watchers.set(id, { w })
    return { ok: true, watching: true }
  } catch (e) {
    return { ok: false, watching: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function setDevConfig(id: string, partial: DevSetting & { ideaPath?: string }): DevConfig {
  if (typeof partial.ideaPath === 'string') store.set('ideaPath', partial.ideaPath)
  const rest: DevSetting = {}
  if ('debug' in partial) rest.debug = partial.debug
  if ('port' in partial) rest.port = partial.port
  if ('projectPath' in partial) rest.projectPath = partial.projectPath
  const map = { ...getMap() }
  map[id] = { ...(map[id] || {}), ...rest }
  store.set('devSettings', map)
  return getDevConfig(id)
}

/** JVM-аргумент отладки (JDWP) для запуска сборки, если включена отладка. Иначе null. */
export function debugJvmArg(id: string): string | null {
  const s = getMap()[id]
  if (!s?.debug) return null
  const port = s.port || 5005
  // server=y,suspend=n — игра стартует сразу, IntelliJ подключается когда удобно
  return `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:${port}`
}

export async function pickProject(): Promise<string | null> {
  const r = await dialog.showOpenDialog({ title: 'Папка проекта мода', properties: ['openDirectory'] })
  return r.filePaths[0] ?? null
}

export async function pickIdea(): Promise<string | null> {
  const r = await dialog.showOpenDialog({
    title: 'Исполняемый файл IntelliJ IDEA (idea64.exe)',
    properties: ['openFile'],
    filters: [{ name: 'IntelliJ', extensions: ['exe', 'cmd', 'bat', 'sh'] }, { name: 'Все файлы', extensions: ['*'] }]
  })
  return r.filePaths[0] ?? null
}

/** Открывает папку проекта в IntelliJ (или в проводнике, если IDE не найдена). */
export function openInIntelliJ(id: string): { ok: boolean; error?: string } {
  const cfg = getDevConfig(id)
  if (!cfg.projectPath) return { ok: false, error: 'Не указана папка проекта' }
  try {
    if (cfg.ideaPath && existsSync(cfg.ideaPath)) {
      spawn(cfg.ideaPath, [cfg.projectPath], { detached: true, stdio: 'ignore' }).unref()
      return { ok: true }
    }
    // best-effort: idea из PATH; если не выйдет — откроем папку
    const p = spawn('idea64', [cfg.projectPath], { detached: true, stdio: 'ignore', shell: true })
    let failed = false
    p.on('error', () => { failed = true; shell.openPath(cfg.projectPath) })
    p.unref()
    return failed
      ? { ok: false, error: 'IntelliJ не найден — открыл папку. Укажите путь к idea64.exe.' }
      : { ok: true }
  } catch {
    shell.openPath(cfg.projectPath)
    return { ok: false, error: 'IntelliJ не найден — открыл папку. Укажите путь к idea64.exe.' }
  }
}

/** Пишет готовый Remote-Debug run-конфиг IntelliJ в проект. */
export function createRunConfig(id: string): { ok: boolean; path?: string; error?: string } {
  const cfg = getDevConfig(id)
  if (!cfg.projectPath) return { ok: false, error: 'Не указана папка проекта' }
  const port = cfg.port || 5005
  const dir = join(cfg.projectPath, '.idea', 'runConfigurations')
  try {
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'FamWorks_Debug.xml')
    const xml = `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="FamWorks Debug (${port})" type="Remote">
    <option name="USE_SOCKET_TRANSPORT" value="true" />
    <option name="SERVER_MODE" value="false" />
    <option name="SHMEM_ADDRESS" />
    <option name="HOST" value="localhost" />
    <option name="PORT" value="${port}" />
    <option name="AUTO_RESTART" value="false" />
    <method v="2" />
  </configuration>
</component>
`
    writeFileSync(file, xml, 'utf8')
    return { ok: true, path: file }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
