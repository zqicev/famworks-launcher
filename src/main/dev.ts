import { dialog, shell, BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, copyFileSync, rmSync, watch, FSWatcher } from 'fs'
import axios from 'axios'
import AdmZip from 'adm-zip'
import { store } from './store'

interface DevSetting { debug?: boolean; port?: number; projectPath?: string; lastJar?: string; hotswap?: boolean }
export interface DevConfig {
  debug: boolean; port: number; projectPath: string; ideaPath: string; watching: boolean
  hotswap: boolean; jbr: string
}

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
    watching: watchers.has(id),
    hotswap: !!s.hotswap,
    jbr: resolveJbr()
  }
}

/** JetBrains Runtime (java из IntelliJ или указанный вручную) — нужен для hot-swap. '' если не найден. */
export function resolveJbr(): string {
  const manual = (store.get('jbrPath') as string) || ''
  if (manual && existsSync(manual)) return manual
  const idea = (store.get('ideaPath') as string) || ''
  if (idea) {
    const root = join(idea, '..', '..') // <IDE>/bin/idea64.exe → <IDE>
    const winCand = join(root, 'jbr', 'bin', 'java.exe')
    if (existsSync(winCand)) return winCand
    const unixCand = join(root, 'jbr', 'bin', 'java')
    if (existsSync(unixCand)) return unixCand
    const macCand = join(root, 'jbr', 'Contents', 'Home', 'bin', 'java')
    if (existsSync(macCand)) return macCand
  }
  return ''
}

export async function pickJbr(): Promise<string | null> {
  const r = await dialog.showOpenDialog({
    title: 'java из JetBrains Runtime (JBR)',
    properties: ['openFile'],
    filters: [{ name: 'java', extensions: ['exe', ''] }, { name: 'Все файлы', extensions: ['*'] }]
  })
  return r.filePaths[0] ?? null
}

/** Переопределения запуска из dev-режима: JBR как JVM (для hot-swap) и JVM-аргументы (отладка/enhanced-redefine). */
export function devLaunchOverrides(id: string): { javaPath: string | null; jvmArgs: string[]; notes: string[] } {
  const s = getMap()[id]
  const jvmArgs: string[] = []
  const notes: string[] = []
  let javaPath: string | null = null

  const debug = !!s?.debug || !!s?.hotswap // hot-swap требует подключённый отладчик
  if (debug) {
    const port = s?.port || 5005
    jvmArgs.push(`-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:${port}`)
    notes.push(`[FamWorks] Отладка на порту ${port}`)
  }
  if (s?.hotswap) {
    const jbr = resolveJbr()
    if (jbr) {
      javaPath = jbr
      // IgnoreUnrecognized — страховка на случай, если билд JBR не знает флаг (тогда просто без enhanced)
      jvmArgs.push('-XX:+IgnoreUnrecognizedVMOptions', '-XX:+AllowEnhancedClassRedefinition')
      notes.push('[FamWorks] Hot-swap включён (JetBrains Runtime). В IntelliJ: Reload Changed Classes.')
    } else {
      notes.push('[FamWorks] Hot-swap не активирован: не найден JetBrains Runtime (укажите IntelliJ или JBR).')
    }
  }
  return { javaPath, jvmArgs, notes }
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

export function setDevConfig(id: string, partial: DevSetting & { ideaPath?: string; jbrPath?: string }): DevConfig {
  if (typeof partial.ideaPath === 'string') store.set('ideaPath', partial.ideaPath)
  if (typeof partial.jbrPath === 'string') store.set('jbrPath', partial.jbrPath)
  const rest: DevSetting = {}
  if ('debug' in partial) rest.debug = partial.debug
  if ('port' in partial) rest.port = partial.port
  if ('projectPath' in partial) rest.projectPath = partial.projectPath
  if ('hotswap' in partial) rest.hotswap = partial.hotswap
  const map = { ...getMap() }
  map[id] = { ...(map[id] || {}), ...rest }
  store.set('devSettings', map)
  return getDevConfig(id)
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

// ---- Генератор шаблона мода ----

export interface GenOpts { name: string; modId: string; loader: string; mcVersion: string; dest: string }

function sanitizeModId(raw: string): string {
  const s = raw.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return /^[a-z]/.test(s) ? s : `mod_${s || 'new'}`
}

function templateUrl(loader: string, mc: string): string | null {
  const minor = mc.split('.')[1]
  if (loader === 'fabric') {
    // ветки fabric-example-mod соответствуют версиям MC
    const branch = minor === '21' ? '1.21' : minor === '20' ? '1.20.4' : '1.21'
    return `https://github.com/FabricMC/fabric-example-mod/archive/refs/heads/${branch}.zip`
  }
  if (loader === 'neoforge') {
    return 'https://github.com/NeoForged/MDK/archive/refs/heads/main.zip'
  }
  return null
}

/** Точечная кастомизация шаблона: id/имя мода в метаданных. */
function customizeTemplate(dir: string, opts: GenOpts): void {
  const fmj = join(dir, 'src', 'main', 'resources', 'fabric.mod.json')
  if (existsSync(fmj)) {
    try {
      const j = JSON.parse(readFileSync(fmj, 'utf8'))
      j.id = opts.modId
      j.name = opts.name
      j.description = `${opts.name} — мод для сборки FamWorks`
      writeFileSync(fmj, JSON.stringify(j, null, 2))
    } catch { /* оставляем как есть */ }
  }
  for (const rel of ['src/main/resources/META-INF/neoforge.mods.toml', 'src/main/resources/META-INF/mods.toml']) {
    const toml = join(dir, ...rel.split('/'))
    if (existsSync(toml)) {
      let t = readFileSync(toml, 'utf8')
      t = t.replace(/modId\s*=\s*"[^"]*"/, `modId="${opts.modId}"`)
        .replace(/displayName\s*=\s*"[^"]*"/, `displayName="${opts.name}"`)
      writeFileSync(toml, t)
    }
  }
  const gp = join(dir, 'gradle.properties')
  if (existsSync(gp)) {
    let g = readFileSync(gp, 'utf8')
    g = g.replace(/^(\s*archives_base_name\s*=).*/m, `$1 ${opts.modId}`)
      .replace(/^(\s*mod_id\s*=).*/m, `$1 ${opts.modId}`)
    writeFileSync(gp, g)
  }
}

/** Скачивает официальный шаблон мода, распаковывает в dest/<modId> и подставляет id/имя. */
export async function generateMod(raw: GenOpts): Promise<{ ok: boolean; path?: string; error?: string }> {
  const opts: GenOpts = { ...raw, modId: sanitizeModId(raw.modId || raw.name) }
  if (!opts.name.trim()) return { ok: false, error: 'Укажите название мода' }
  if (!opts.dest) return { ok: false, error: 'Укажите папку назначения' }
  const url = templateUrl(opts.loader, opts.mcVersion)
  if (!url) return { ok: false, error: `Нет шаблона для загрузчика ${opts.loader} (пока Fabric и NeoForge)` }

  const projectDir = join(opts.dest, opts.modId)
  if (existsSync(projectDir)) return { ok: false, error: `Папка ${opts.modId} уже существует` }

  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, maxRedirects: 5 })
    const zip = new AdmZip(Buffer.from(res.data))
    mkdirSync(projectDir, { recursive: true })
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue
      const rel = e.entryName.replace(/^[^/]+\//, '') // убираем верхнюю папку архива
      if (!rel) continue
      const out = join(projectDir, rel)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, e.getData())
    }
    customizeTemplate(projectDir, opts)
    return { ok: true, path: projectDir }
  } catch (e) {
    try { rmSync(projectDir, { recursive: true, force: true }) } catch { /* ignore */ }
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Не удалось скачать шаблон (нужен доступ к github.com): ${msg}` }
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
