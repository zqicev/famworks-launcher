import { dialog, shell } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { store } from './store'

interface DevSetting { debug?: boolean; port?: number; projectPath?: string }
export interface DevConfig { debug: boolean; port: number; projectPath: string; ideaPath: string }

function getMap(): Record<string, DevSetting> {
  return (store.get('devSettings') as Record<string, DevSetting>) || {}
}

export function getDevConfig(id: string): DevConfig {
  const s = getMap()[id] || {}
  return {
    debug: !!s.debug,
    port: s.port || 5005,
    projectPath: s.projectPath || '',
    ideaPath: (store.get('ideaPath') as string) || ''
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
