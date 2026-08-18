import { dialog, app } from 'electron'
import { join, dirname, sep, resolve } from 'path'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync, readdirSync } from 'fs'
import axios from 'axios'
import AdmZip from 'adm-zip'
import { store } from './store'
import { fetchModpack } from './modpacks'
import { Modpack, Mod } from '../types/modpack'

export interface ExportResult { ok?: boolean; path?: string; cancelled?: boolean }
export interface ImportResult { ok?: boolean; modpack?: Modpack; cancelled?: boolean }
export interface DirEntry { name: string; isDir: boolean; size: number; mtime: number }

/** Отметки выбора для экспорта: путь (posix, относительно корня сборки) → включён/исключён.
 *  Действует ближайший предок: если у файла нет своей отметки, берётся отметка родителя и т.д.
 *  Корень по умолчанию 'out' (ничего не выбрано). */
export type ExportMark = 'in' | 'out'

function slugify(s: string): string {
  return (s || 'pack').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'pack'
}

/** Содержимое одной папки внутри сборки (для дерева выбора при экспорте). Ленивая загрузка по уровням. */
export function listPackDir(id: string, relPath: string): DirEntry[] {
  const installPath = store.get('installPath') as string
  if (!installPath) return []
  const gameRoot = resolve(join(installPath, id))
  const target = resolve(gameRoot, relPath || '.')
  // защита от выхода за пределы папки сборки
  if (target !== gameRoot && !target.startsWith(gameRoot + sep)) return []
  if (!existsSync(target) || !statSync(target).isDirectory()) return []

  const out: DirEntry[] = []
  for (const name of readdirSync(target)) {
    try {
      const st = statSync(join(target, name))
      out.push({ name, isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtime: st.mtimeMs })
    } catch { /* недоступный файл — пропускаем */ }
  }
  // папки сверху, затем файлы; внутри — по алфавиту
  out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'ru') : a.isDir ? -1 : 1))
  return out
}

/** Эффективная отметка пути: ближайший предок-или-он-сам с явной отметкой; иначе 'out'. */
function resolveMark(rel: string, marks: Record<string, ExportMark>): ExportMark {
  let p = rel
  for (;;) {
    if (marks[p]) return marks[p]
    const i = p.lastIndexOf('/')
    if (i < 0) return 'out'
    p = p.slice(0, i)
  }
}

/** Есть ли под этим путём хоть одна явная отметка (значит поддерево «смешанное»). */
function hasDescendantMark(rel: string, marks: Record<string, ExportMark>): boolean {
  const prefix = rel + '/'
  return Object.keys(marks).some(k => k.startsWith(prefix))
}

/** Кладёт в zip выбранные файлы/папки, отсекая целиком невыбранные поддеревья (saves/versions/assets и т.п.). */
function collectSelected(gameRoot: string, relDir: string, marks: Record<string, ExportMark>, zip: AdmZip): void {
  const absDir = relDir ? join(gameRoot, relDir) : gameRoot
  let names: string[]
  try { names = readdirSync(absDir) } catch { return }
  for (const name of names) {
    const rel = relDir ? `${relDir}/${name}` : name
    const abs = join(absDir, name)
    let isDir: boolean
    try { isDir = statSync(abs).isDirectory() } catch { continue }
    if (isDir) {
      if (hasDescendantMark(rel, marks)) collectSelected(gameRoot, rel, marks, zip) // смешанное — вглубь
      else if (resolveMark(rel, marks) === 'in') zip.addLocalFolder(abs, rel)        // папка целиком
      // 'out' и без вложенных отметок — пропускаем целиком (не ходим внутрь)
    } else if (resolveMark(rel, marks) === 'in') {
      zip.addLocalFile(abs, relDir)
    }
  }
}

/** Экспорт сборки в .fwpack по выбору пользователя (modpack.json + выбранные файлы/папки). */
export async function exportModpackSelected(id: string, marks: Record<string, ExportMark>): Promise<ExportResult> {
  const modpack = await fetchModpack(id)
  const installPath = store.get('installPath') as string
  const gameRoot = join(installPath, id)

  const res = await dialog.showSaveDialog({
    title: 'Экспорт сборки',
    defaultPath: `${slugify(modpack.name)}.fwpack`,
    filters: [{ name: 'FamWorks сборка', extensions: ['fwpack'] }]
  })
  if (res.canceled || !res.filePath) return { cancelled: true }

  const zip = new AdmZip()
  zip.addFile('modpack.json', Buffer.from(JSON.stringify(modpack, null, 2), 'utf8'))
  if (existsSync(gameRoot) && statSync(gameRoot).isDirectory()) collectSelected(gameRoot, '', marks, zip)

  zip.writeZip(res.filePath)
  return { ok: true, path: res.filePath }
}

/** Импорт сборки через диалог: принимает .fwpack (FamWorks) и .mrpack (Modrinth). */
export async function importModpack(): Promise<ImportResult> {
  const res = await dialog.showOpenDialog({
    title: 'Импорт сборки',
    filters: [{ name: 'Сборка Minecraft (FamWorks, Modrinth)', extensions: ['fwpack', 'mrpack'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths[0]) return { cancelled: true }
  return importFromFile(res.filePaths[0])
}

/** Импорт из файла: определяет формат (.mrpack или .fwpack) по содержимому и создаёт кастомную сборку. */
export async function importFromFile(filePath: string): Promise<ImportResult> {
  const installPath = store.get('installPath') as string
  if (!installPath) throw new Error('Сначала завершите настройку лаунчера (выбор папки установки)')

  const zip = new AdmZip(filePath)
  if (zip.getEntry('modrinth.index.json')) return importMrpack(zip, installPath)
  if (zip.getEntry('modpack.json')) return importFwpack(zip, installPath)
  throw new Error('Неизвестный формат: это не .fwpack и не .mrpack')
}

/** .fwpack → кастомная сборка (modpack.json + распаковка mods/config/... в папку игры). */
function importFwpack(zip: AdmZip, installPath: string): ImportResult {
  const meta = JSON.parse(zip.readAsText(zip.getEntry('modpack.json')!)) as Modpack
  if (!meta.mc_version || !meta.loader || !meta.loader_version) {
    throw new Error('Повреждённый файл сборки: не хватает данных о версии/загрузчике')
  }

  const id = `custom-${slugify(meta.name)}-${Date.now().toString(36)}`
  const gameRoot = join(installPath, id)
  mkdirSync(gameRoot, { recursive: true })

  zip.extractAllTo(gameRoot, true)
  rmSync(join(gameRoot, 'modpack.json'), { force: true }) // не нужен в папке игры

  const modpack: Modpack = {
    ...meta,
    id,
    name: meta.name || 'Импортированная сборка',
    updated_at: new Date().toISOString(),
    mods: Array.isArray(meta.mods) ? meta.mods : [],
    changelog: Array.isArray(meta.changelog) ? meta.changelog : []
  }
  saveCustom(modpack)
  return { ok: true, modpack }
}

interface MrpackIndex {
  name?: string
  summary?: string
  dependencies?: Record<string, string>
  files?: {
    path: string
    hashes?: { sha1?: string; sha512?: string }
    downloads?: string[]
    fileSize?: number
    env?: { client?: string; server?: string }
  }[]
}

/** .mrpack (Modrinth) → кастомная сборка: моды/пакеты качаются по URL из манифеста,
 *  overrides (конфиги и прочие файлы) распаковываются прямо в папку игры. */
function importMrpack(zip: AdmZip, installPath: string): ImportResult {
  const idx = JSON.parse(zip.readAsText(zip.getEntry('modrinth.index.json')!)) as MrpackIndex
  const deps = idx.dependencies ?? {}
  const mc = deps.minecraft
  if (!mc) throw new Error('В .mrpack не указана версия Minecraft')

  let loader: Modpack['loader'] = 'vanilla'
  let loaderVersion = ''
  if (deps['fabric-loader']) { loader = 'fabric'; loaderVersion = deps['fabric-loader'] }
  else if (deps['quilt-loader']) { loader = 'quilt'; loaderVersion = deps['quilt-loader'] }
  else if (deps['forge']) { loader = 'forge'; loaderVersion = deps['forge'] }
  else if (deps['neoforge']) { loader = 'neoforge'; loaderVersion = deps['neoforge'] }

  const name = idx.name || 'Импортированная сборка'
  const id = `custom-${slugify(name)}-${Date.now().toString(36)}`
  const gameRoot = join(installPath, id)
  mkdirSync(gameRoot, { recursive: true })

  const mods: Mod[] = []
  const resourcepacks: Mod[] = []
  const shaders: Mod[] = []
  for (const f of idx.files ?? []) {
    if (f.env?.client === 'unsupported') continue // файл только для сервера - пропускаем
    const url = f.downloads?.[0]
    if (!url || !f.path) continue
    const p = f.path.replace(/\\/g, '/')
    const filename = p.split('/').pop() ?? ''
    if (!filename) continue
    const item: Mod = {
      id: filename.replace(/\.(jar|zip)$/i, '') || filename,
      name: filename,
      filename,
      version: '',
      category: '',
      size_mb: f.fileSize ? +(f.fileSize / 1048576).toFixed(2) : 0,
      required: f.env?.client !== 'optional',
      download_url: url,
      sha512: f.hashes?.sha512,
      sha1: f.hashes?.sha1
    }
    if (p.startsWith('resourcepacks/')) resourcepacks.push(item)
    else if (p.startsWith('shaderpacks/')) shaders.push(item)
    else mods.push(item) // mods/ и всё остальное
  }

  // overrides / client-overrides - статические файлы, кладём как есть в папку игры
  extractOverrides(zip, gameRoot, 'overrides')
  extractOverrides(zip, gameRoot, 'client-overrides')

  const modpack: Modpack = {
    id,
    name,
    description: idx.summary || 'Импортировано из Modrinth',
    long_description: '',
    mc_version: mc,
    loader,
    loader_version: loaderVersion,
    fabric_api_version: '', // Fabric API уже входит в моды сборки - отдельно не тянем
    updated_at: new Date().toISOString(),
    changelog: [],
    mods,
    ...(resourcepacks.length ? { resourcepacks } : {}),
    ...(shaders.length ? { shaders } : {})
  }
  saveCustom(modpack)
  return { ok: true, modpack }
}

/** Распаковывает поддерево zip (напр. overrides/…) в gameRoot, защищаясь от zip-slip (выход за пределы). */
function extractOverrides(zip: AdmZip, gameRoot: string, prefix: string): void {
  const base = prefix + '/'
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith(base)) continue
    const rel = e.entryName.slice(base.length)
    if (!rel) continue
    const dest = join(gameRoot, rel)
    if (dest !== gameRoot && !dest.startsWith(gameRoot + sep)) continue
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, e.getData())
  }
}

function saveCustom(modpack: Modpack): void {
  const list = (store.get('customModpacks') as Modpack[]).filter(m => m.id !== modpack.id)
  list.push(modpack)
  store.set('customModpacks', list)
}

/** Устанавливает сборку с Modrinth: качает последний .mrpack проекта и импортирует его. */
export async function installModrinthModpack(projectId: string): Promise<ImportResult> {
  const { data } = await axios.get(`https://api.modrinth.com/v2/project/${projectId}/version`, {
    headers: { 'User-Agent': 'famworks-launcher/1.0' },
    timeout: 15000
  })
  type MrVersion = { date_published: string; version_type?: string; files: { url: string; filename: string; primary: boolean }[] }
  const versions = (data as MrVersion[])
    .slice()
    .sort((a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime())

  const hasPack = (v: MrVersion) => (v.files ?? []).some(f => /\.mrpack$/i.test(f.filename))
  // Предпочитаем последнюю релизную версию, иначе просто последнюю с .mrpack (beta/alpha).
  const pick = versions.find(v => v.version_type === 'release' && hasPack(v)) ?? versions.find(hasPack)
  const files = pick?.files ?? []
  const file = files.find(f => f.primary && /\.mrpack$/i.test(f.filename)) ?? files.find(f => /\.mrpack$/i.test(f.filename))
  if (!file) throw new Error('У этой сборки нет файла .mrpack для установки')

  const tmp = join(app.getPath('temp'), `fw-${Date.now()}-${file.filename}`)
  const resp = await axios.get(file.url, { responseType: 'arraybuffer', timeout: 60000, maxRedirects: 5 })
  writeFileSync(tmp, Buffer.from(resp.data))
  try {
    return await importFromFile(tmp)
  } finally {
    try { rmSync(tmp, { force: true }) } catch {}
  }
}
