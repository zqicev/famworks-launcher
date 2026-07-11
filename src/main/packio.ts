import { dialog, app } from 'electron'
import { join, dirname, sep } from 'path'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'fs'
import axios from 'axios'
import AdmZip from 'adm-zip'
import { store } from './store'
import { fetchModpack } from './modpacks'
import { Modpack, Mod } from '../types/modpack'

// Что кладём в .fwpack (worlds/logs/versions/assets не трогаем - они личные/восстановимые)
const CONTENT_DIRS = ['mods', 'resourcepacks', 'shaderpacks', 'config']

export interface ExportResult { ok?: boolean; path?: string; cancelled?: boolean }
export interface ImportResult { ok?: boolean; modpack?: Modpack; cancelled?: boolean }

function slugify(s: string): string {
  return (s || 'pack').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'pack'
}

/** Экспорт сборки в файл .fwpack (zip: modpack.json + mods/resourcepacks/shaderpacks/config + options.txt). */
export async function exportModpack(id: string): Promise<ExportResult> {
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
  for (const sub of CONTENT_DIRS) {
    const dir = join(gameRoot, sub)
    if (existsSync(dir) && statSync(dir).isDirectory()) zip.addLocalFolder(dir, sub)
  }
  const opts = join(gameRoot, 'options.txt')
  if (existsSync(opts)) zip.addLocalFile(opts)

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
  const versions = (data as { date_published: string; files: { url: string; filename: string; primary: boolean }[] }[])
    .slice()
    .sort((a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime())

  let file: { url: string; filename: string } | undefined
  for (const v of versions) {
    const files = v.files ?? []
    file = files.find(f => f.primary && /\.mrpack$/i.test(f.filename)) ?? files.find(f => /\.mrpack$/i.test(f.filename))
    if (file) break
  }
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
