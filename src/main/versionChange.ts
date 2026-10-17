import { BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, unlinkSync, renameSync, statSync } from 'fs'
import { Modpack, Mod } from '../types/modpack'
import { store } from './store'
import { getModVersions } from './modrinth'
import { getCurseforgeFiles, cfSha1 } from './curseforge'
import { resolveFamworks } from './portalMods'
import { latestLoaderVersion, LoaderId } from './loaders'
import { downloadModToDir } from './installer'

// ───────── Смена версии Minecraft у пользовательской сборки (миграция ресурсов) ─────────

export type ItemKind = 'mod' | 'resourcepack' | 'shader'
export type ItemDecision = 'keep' | 'disable' | 'delete'

export interface VersionItem {
  kind: ItemKind
  id: string
  name: string
  source: 'modrinth' | 'curseforge' | 'famworks' | 'download' | 'local'
  compatible: boolean
  oldFilename: string
  newFilename?: string
  newVersion?: string
  // служебные поля для применения (в UI не нужны)
  _url?: string
  _sha512?: string
  _sha1?: string
  _size?: number
}

export interface VersionPlan {
  packId: string
  oldMc: string
  newMc: string
  loader: string
  loaderVersion: string | null
  fabricApiVersion: string | null
  items: VersionItem[]
}

const MR_TYPE: Record<ItemKind, string> = { mod: 'mod', resourcepack: 'resourcepack', shader: 'shader' }
const FABRIC_API_ID = 'P7dR8mSH'

function sourceOf(m: Mod): VersionItem['source'] {
  if (m.modrinth_id) return 'modrinth'
  if (m.curseforge_id) return 'curseforge'
  if (m.famworks_id) return 'famworks'
  if (m.download_url) return 'download'
  return 'local'
}

function customPack(packId: string): Modpack | null {
  const list = (store.get('customModpacks') as Modpack[] | undefined) ?? []
  return list.find(m => m.id === packId) ?? null
}

/** Ищет версию ресурса под новую MC. compatible=false — перенести нельзя (нет версии / фикс. ссылка / локальный). */
async function resolveItem(m: Mod, kind: ItemKind, newMc: string, loader: string): Promise<VersionItem> {
  const base: VersionItem = { kind, id: m.id, name: m.name, source: sourceOf(m), compatible: false, oldFilename: m.filename }
  try {
    if (m.modrinth_id) {
      const v = (await getModVersions(m.modrinth_id, newMc, loader, MR_TYPE[kind]))[0]
      const f = v?.files.find(x => x.primary) ?? v?.files?.[0]
      if (v && f?.url) return { ...base, compatible: true, newFilename: f.filename, newVersion: v.version_number, _url: f.url, _sha512: f.hashes?.sha512, _size: f.size }
    } else if (m.curseforge_id) {
      const f = (await getCurseforgeFiles(m.curseforge_id, newMc, loader, kind)).find(x => x.downloadUrl)
      if (f?.downloadUrl) return { ...base, compatible: true, newFilename: f.fileName, newVersion: f.displayName, _url: f.downloadUrl, _sha1: cfSha1(f), _size: f.fileLength }
    } else if (m.famworks_id) {
      const data = await resolveFamworks(newMc, loader, [{ id: m.famworks_id, version: m.famworks_version || undefined }])
      const entry = data.mods.find(e => e.id === m.famworks_id)
      const ver = entry?.status === 'ok' ? entry.version : undefined
      const f = ver ? (ver.files.find(x => x.primary) ?? ver.files[0]) : undefined
      if (ver && f?.url) return { ...base, compatible: true, newFilename: f.filename, newVersion: ver.version_number, _url: f.url, _sha512: f.hashes?.sha512, _sha1: f.hashes?.sha1, _size: f.size }
    }
    // download_url / local — фиксированная версия, перенести нельзя
  } catch { /* сеть / нет совместимой версии → несовместим */ }
  return base
}

/** Собирает план миграции: что переедет, что нет, и какие версии загрузчика/Fabric API под новую MC. */
export async function planVersionChange(packId: string, newMc: string): Promise<VersionPlan> {
  const pack = customPack(packId)
  if (!pack) throw new Error('Сборка не найдена')
  const loader = pack.loader
  const items: VersionItem[] = []
  for (const m of pack.mods) items.push(await resolveItem(m, 'mod', newMc, loader))
  for (const p of pack.resourcepacks ?? []) items.push(await resolveItem(p, 'resourcepack', newMc, loader))
  for (const s of pack.shaders ?? []) items.push(await resolveItem(s, 'shader', newMc, loader))

  let loaderVersion: string | null = null
  try { loaderVersion = await latestLoaderVersion(loader as LoaderId, newMc) } catch { /* оставим прежнюю */ }

  let fabricApiVersion: string | null = null
  if (loader === 'fabric' || loader === 'quilt') {
    try { fabricApiVersion = (await getModVersions(FABRIC_API_ID, newMc, loader, 'mod'))[0]?.version_number ?? null } catch { /* оставим */ }
  }

  return { packId, oldMc: pack.mc_version, newMc, loader, loaderVersion, fabricApiVersion, items }
}

function emit(win: BrowserWindow, event: unknown): void {
  try { if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('install:progress', event) } catch { /* окно закрыто */ }
}

/** Применяет план: качает новые версии совместимых, убирает старые файлы, решает судьбу несовместимых,
 *  пишет сборку под новую MC (+ версии загрузчика/Fabric API). Дальше статус станет «Установить». */
export async function applyVersionChange(
  packId: string,
  plan: VersionPlan,
  decisions: Record<string, ItemDecision>,
  win: BrowserWindow
): Promise<{ ok: boolean; error?: string }> {
  const pack = customPack(packId)
  if (!pack) return { ok: false, error: 'Сборка не найдена' }
  const installPath = store.get('installPath') as string
  const gameRoot = join(installPath, packId)
  const dirFor = (k: ItemKind): string => join(gameRoot, k === 'mod' ? 'mods' : k === 'resourcepack' ? 'resourcepacks' : 'shaderpacks')
  const byId = new Map(plan.items.map(i => [`${i.kind}:${i.id}`, i]))

  const removeFile = (dir: string, fn: string): void => {
    for (const p of [join(dir, fn), join(dir, fn + '.disabled')]) {
      try { if (existsSync(p) && !statSync(p).isDirectory()) unlinkSync(p) } catch { /* занято */ }
    }
  }
  const disableFile = (dir: string, fn: string): void => {
    try { const p = join(dir, fn); if (existsSync(p) && !existsSync(p + '.disabled')) renameSync(p, p + '.disabled') } catch { /* занято */ }
  }

  const total = plan.items.length
  let done = 0
  const migrate = async (arr: Mod[], kind: ItemKind): Promise<Mod[]> => {
    const out: Mod[] = []
    const dir = dirFor(kind)
    for (const m of arr) {
      const item = byId.get(`${kind}:${m.id}`)
      if (item?.compatible && item._url && item.newFilename) {
        emit(win, { phase: 'download', message: `Перенос ${m.name}`, current: done, total })
        try {
          await downloadModToDir(item._url, item.newFilename, dir, win, item._sha512, item._sha1)
          if (item.newFilename !== m.filename) removeFile(dir, m.filename)
          out.push({
            ...m,
            filename: item.newFilename,
            version: item.newVersion ?? m.version,
            size_mb: item._size ? Math.round(item._size / 1024 / 1024 * 10) / 10 : m.size_mb
          })
        } catch {
          out.push(m) // не скачалось — оставляем, доустановится позже
        }
      } else {
        const d = decisions[`${kind}:${m.id}`] ?? 'keep'
        if (d === 'delete') removeFile(dir, m.filename)              // убрать файл и из JSON
        else if (d === 'disable') disableFile(dir, m.filename)        // файл .disabled, из JSON убрать
        else out.push(m)                                             // keep — оставить как есть
      }
      done++
    }
    return out
  }

  try {
    const mods = await migrate(pack.mods, 'mod')
    const resourcepacks = await migrate(pack.resourcepacks ?? [], 'resourcepack')
    const shaders = await migrate(pack.shaders ?? [], 'shader')

    const updated: Modpack = {
      ...pack,
      mc_version: plan.newMc,
      loader_version: plan.loaderVersion || pack.loader_version,
      fabric_api_version: plan.fabricApiVersion || pack.fabric_api_version,
      mods,
      resourcepacks,
      shaders,
      updated_at: new Date().toISOString()
    }
    const list = (store.get('customModpacks') as Modpack[]).filter(m => m.id !== packId)
    list.push(updated)
    store.set('customModpacks', list)
    emit(win, { phase: 'done', message: '' })
    return { ok: true }
  } catch (e) {
    emit(win, { phase: 'done', message: '' })
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
