import { dialog } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, rmSync, statSync } from 'fs'
import AdmZip from 'adm-zip'
import { store } from './store'
import { fetchModpack } from './modpacks'
import { Modpack } from '../types/modpack'

// Что кладём в .fwpack (worlds/logs/versions/assets не трогаем — они личные/восстановимые)
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

/** Импорт .fwpack как новой кастомной сборки (новый id, распаковка файлов в папку сборки). */
export async function importModpack(): Promise<ImportResult> {
  const res = await dialog.showOpenDialog({
    title: 'Импорт сборки',
    filters: [{ name: 'FamWorks сборка', extensions: ['fwpack'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths[0]) return { cancelled: true }

  const zip = new AdmZip(res.filePaths[0])
  const entry = zip.getEntry('modpack.json')
  if (!entry) throw new Error('Это не файл сборки FamWorks (нет modpack.json)')
  const meta = JSON.parse(zip.readAsText(entry)) as Modpack
  if (!meta.mc_version || !meta.loader || !meta.loader_version) {
    throw new Error('Повреждённый файл сборки: не хватает данных о версии/загрузчике')
  }

  const installPath = store.get('installPath') as string
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
  const list = (store.get('customModpacks') as Modpack[]).filter(m => m.id !== id)
  list.push(modpack)
  store.set('customModpacks', list)
  return { ok: true, modpack }
}
