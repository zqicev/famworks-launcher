import { dialog, app } from 'electron'
import { join, sep, resolve } from 'path'
import { existsSync, mkdirSync, rmSync, statSync, readdirSync, renameSync, createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import type { Readable } from 'stream'
import axios from 'axios'
import { store } from './store'
import { ZipWriter } from './zipWriter'
import { openZipReader, safeTarget, ZipReader } from './zipReader'
import { hashFile } from './fileHash'
import { fetchModpack } from './modpacks'
import { Modpack, Mod } from '../types/modpack'
import { slugify, baseCustomId } from '../shared/slug'
import { packDir } from './packpaths'

export interface ExportResult { ok?: boolean; path?: string; cancelled?: boolean }
export interface ImportResult { ok?: boolean; modpack?: Modpack; cancelled?: boolean }
export interface DirEntry { name: string; isDir: boolean; size: number; mtime: number }

/** Отметки выбора для экспорта: путь (posix, относительно корня сборки) → включён/исключён.
 *  Действует ближайший предок: если у файла нет своей отметки, берётся отметка родителя и т.д.
 *  Корень по умолчанию 'out' (ничего не выбрано). */
export type ExportMark = 'in' | 'out'

/** Уникальный читаемый id (= имя папки) для импортируемой сборки: custom-<translit-slug>,
 *  уникальный и по списку сборок, и по фактическим папкам под installPath. */
function newCustomId(name: string, installPath: string): string {
  const usedIds = new Set((store.get('customModpacks') as Modpack[]).map(m => m.id))
  const taken = (id: string): boolean => usedIds.has(id) || existsSync(join(installPath, id))
  const base = baseCustomId(name)
  if (!taken(base)) return base
  let n = 2
  while (taken(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** Содержимое одной папки внутри сборки (для дерева выбора при экспорте). Ленивая загрузка по уровням. */
export function listPackDir(id: string, relPath: string): DirEntry[] {
  const installPath = store.get('installPath') as string
  if (!installPath) return []
  const gameRoot = resolve(packDir(id))
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
async function collectSelected(gameRoot: string, relDir: string, marks: Record<string, ExportMark>, zip: ZipWriter): Promise<void> {
  const absDir = relDir ? join(gameRoot, relDir) : gameRoot
  let names: string[]
  try { names = readdirSync(absDir) } catch { return }
  for (const name of names) {
    const rel = relDir ? `${relDir}/${name}` : name
    const abs = join(absDir, name)
    let isDir: boolean
    try { isDir = statSync(abs).isDirectory() } catch { continue }
    if (isDir) {
      if (hasDescendantMark(rel, marks)) await collectSelected(gameRoot, rel, marks, zip) // смешанное — вглубь
      else if (resolveMark(rel, marks) === 'in') await zip.addDir(abs, rel)               // папка целиком
      // 'out' и без вложенных отметок — пропускаем целиком (не ходим внутрь)
    } else if (resolveMark(rel, marks) === 'in') {
      await zip.addFile(abs, rel)
    }
  }
}

/** Пишет архив потоком во временный файл рядом с целью и подменяет цель только целиком: на диске нет
 *  недописанного архива, а прежний файл (если пользователь его перезаписывает) не теряется при сбое. */
async function writeZipAtomically(target: string, fill: (zip: ZipWriter) => Promise<void>): Promise<void> {
  const part = `${target}.part`
  const zip = await ZipWriter.create(part)
  try {
    await fill(zip)
    await zip.finish()
  } catch (e) {
    await zip.abort()
    try { rmSync(part, { force: true }) } catch { /* ignore */ }
    throw e
  }
  try { rmSync(target, { force: true }) } catch { /* ignore */ }
  renameSync(part, target)
}

/** Экспорт сборки в .fwpack по выбору пользователя (modpack.json + выбранные файлы/папки). */
export async function exportModpackSelected(id: string, marks: Record<string, ExportMark>): Promise<ExportResult> {
  const modpack = await fetchModpack(id)
  const installPath = store.get('installPath') as string
  const gameRoot = packDir(id)

  const res = await dialog.showSaveDialog({
    title: 'Экспорт сборки',
    defaultPath: `${slugify(modpack.name) || 'pack'}.fwpack`,
    filters: [{ name: 'FamWorks сборка', extensions: ['fwpack'] }]
  })
  if (res.canceled || !res.filePath) return { cancelled: true }

  await writeZipAtomically(res.filePath, async (zip) => {
    await zip.addBuffer('modpack.json', Buffer.from(JSON.stringify(modpack, null, 2), 'utf8'))
    if (existsSync(gameRoot) && statSync(gameRoot).isDirectory()) await collectSelected(gameRoot, '', marks, zip)
  })
  return { ok: true, path: res.filePath }
}

/** Обходит все выбранные ФАЙЛЫ (per-file), отсекая целиком невыбранные поддеревья. */
function eachSelectedFile(gameRoot: string, relDir: string, marks: Record<string, ExportMark>, cb: (rel: string, abs: string) => void): void {
  const absDir = relDir ? join(gameRoot, relDir) : gameRoot
  let names: string[]
  try { names = readdirSync(absDir) } catch { return }
  for (const name of names) {
    const rel = relDir ? `${relDir}/${name}` : name
    const abs = join(absDir, name)
    let isDir: boolean
    try { isDir = statSync(abs).isDirectory() } catch { continue }
    if (isDir) {
      // пропускаем целиком, только если папка исключена и внутри нет отдельных отметок
      if (resolveMark(rel, marks) === 'out' && !hasDescendantMark(rel, marks)) continue
      eachSelectedFile(gameRoot, rel, marks, cb)
    } else if (resolveMark(rel, marks) === 'in') {
      cb(rel, abs)
    }
  }
}

interface MrFile {
  path: string
  hashes: { sha1?: string; sha512?: string }
  env: { client: string; server: string }
  downloads: string[]
  fileSize?: number
}

/** Экспорт в формат Modrinth (.mrpack): моды/пакеты с URL идут в манифест по ссылке,
 *  остальные выбранные файлы (конфиги, локальные jar без ссылки) - в overrides/. */
export async function exportModpackMrpack(id: string, marks: Record<string, ExportMark>): Promise<ExportResult> {
  const modpack = await fetchModpack(id)
  const installPath = store.get('installPath') as string
  const gameRoot = packDir(id)

  const res = await dialog.showSaveDialog({
    title: 'Экспорт сборки (Modrinth)',
    defaultPath: `${slugify(modpack.name) || 'pack'}.mrpack`,
    filters: [{ name: 'Modrinth сборка', extensions: ['mrpack'] }]
  })
  if (res.canceled || !res.filePath) return { cancelled: true }

  // Карта «путь в сборке → данные для ссылки» из определения (только у кого есть download_url).
  interface Ref { url: string; sha1?: string; sha512?: string; optional: boolean; clientOnly: boolean }
  const refMap = new Map<string, Ref>()
  const addRefs = (items: Mod[] | undefined, dir: string, clientOnly: boolean): void => {
    for (const m of items ?? []) {
      if (!m.download_url || !m.filename) continue
      refMap.set(`${dir}/${m.filename}`, { url: m.download_url, sha1: m.sha1, sha512: m.sha512, optional: m.required === false, clientOnly })
    }
  }
  addRefs(modpack.mods, 'mods', false)
  addRefs(modpack.resourcepacks, 'resourcepacks', true)
  addRefs(modpack.shaders, 'shaderpacks', true)

  const files: MrFile[] = []
  const selected: { rel: string; abs: string }[] = []
  if (existsSync(gameRoot) && statSync(gameRoot).isDirectory()) {
    eachSelectedFile(gameRoot, '', marks, (rel, abs) => { selected.push({ rel, abs }) })
  }

  const deps: Record<string, string> = { minecraft: modpack.mc_version }
  const loaderKey: Record<string, string> = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge', neoforge: 'neoforge' }
  const lk = loaderKey[modpack.loader]
  if (lk && modpack.loader_version) deps[lk] = modpack.loader_version

  await writeZipAtomically(res.filePath, async (zip) => {
    for (const { rel, abs } of selected) {
      const ref = refMap.get(rel)
      if (ref) {
        // Хэши считаем с диска (потоково) - так они гарантированно совпадают с тем, что ставится по ссылке.
        let sha1 = ref.sha1
        let sha512 = ref.sha512
        let size = 0
        try {
          const h = await hashFile(abs, ['sha1', 'sha512'] as const)
          size = h.size
          sha1 = h.hex.sha1
          sha512 = h.hex.sha512
        } catch { /* нет файла на диске - используем объявленные хэши */ }
        const hashes: MrFile['hashes'] = {}
        if (sha1) hashes.sha1 = sha1
        if (sha512) hashes.sha512 = sha512
        const env = ref.clientOnly
          ? { client: ref.optional ? 'optional' : 'required', server: 'unsupported' }
          : { client: ref.optional ? 'optional' : 'required', server: ref.optional ? 'optional' : 'required' }
        files.push({ path: rel, hashes, env, downloads: [ref.url], ...(size ? { fileSize: size } : {}) })
      } else {
        // Без ссылки - упаковываем как есть в overrides (Modrinth разложит их в корень игры).
        // Недоступный файл addFile просто пропускает.
        await zip.addFile(abs, `overrides/${rel}`)
      }
    }

    const index = {
      formatVersion: 1,
      game: 'minecraft',
      versionId: modpack.changelog?.[0]?.version || '1.0.0',
      name: modpack.name,
      summary: modpack.description || '',
      files,
      dependencies: deps
    }
    await zip.addBuffer('modrinth.index.json', Buffer.from(JSON.stringify(index, null, 2), 'utf8'))
  })
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

  // Потоково: в памяти только оглавление архива, файлы распаковываются прямо на диск.
  const zip = await openZipReader(filePath)
  try {
    if (zip.get('modrinth.index.json')) return await importMrpack(zip, installPath)
    if (zip.get('modpack.json')) return await importFwpack(zip, installPath)
  } finally {
    zip.close()
  }
  throw new Error('Неизвестный формат: это не .fwpack и не .mrpack')
}

/** .fwpack → кастомная сборка (modpack.json + распаковка mods/config/... в папку игры). */
async function importFwpack(zip: ZipReader, installPath: string): Promise<ImportResult> {
  const meta = JSON.parse((await zip.readText('modpack.json')) ?? '{}') as Modpack
  if (!meta.mc_version || !meta.loader || !meta.loader_version) {
    throw new Error('Повреждённый файл сборки: не хватает данных о версии/загрузчике')
  }

  const id = newCustomId(meta.name || 'pack', installPath)
  const gameRoot = packDir(id)
  mkdirSync(gameRoot, { recursive: true })

  for (const it of zip.items) {
    if (it.name === 'modpack.json') continue // не нужен в папке игры
    const dest = safeTarget(gameRoot, it.name)
    if (dest) await zip.extractTo(it, dest)
  }

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
async function importMrpack(zip: ZipReader, installPath: string): Promise<ImportResult> {
  const idx = JSON.parse((await zip.readText('modrinth.index.json')) ?? '{}') as MrpackIndex
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
  const id = newCustomId(name, installPath)
  const gameRoot = packDir(id)
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
  await extractOverrides(zip, gameRoot, 'overrides')
  await extractOverrides(zip, gameRoot, 'client-overrides')

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
async function extractOverrides(zip: ZipReader, gameRoot: string, prefix: string): Promise<void> {
  const base = prefix + '/'
  for (const it of zip.items) {
    if (it.isDir || !it.name.startsWith(base)) continue
    const rel = it.name.slice(base.length)
    if (!rel) continue
    const dest = join(gameRoot, rel)
    if (dest !== gameRoot && !dest.startsWith(gameRoot + sep)) continue
    await zip.extractTo(it, dest)
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
  try {
    // Качаем потоком прямо в файл (а не arraybuffer целиком в память — .mrpack с overrides бывает большим).
    const resp = await axios.get<Readable>(file.url, { responseType: 'stream', timeout: 60000, maxRedirects: 5 })
    await pipeline(resp.data, createWriteStream(tmp))
    return await importFromFile(tmp)
  } finally {
    try { rmSync(tmp, { force: true }) } catch {}
  }
}
