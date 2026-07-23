import { BrowserWindow } from 'electron'
import { join } from 'path'
import { readdirSync } from 'fs'
import { getModVersions, getModrinthVersion, ModrinthVersion } from './modrinth'
import { getCurseforgeFiles, cfSha1, CfFile } from './curseforge'
import { downloadModToDir } from './installer'

const FOLDER: Record<string, string> = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }
const MAX_DEPTH = 8 // страховка от слишком длинных цепочек зависимостей

/** «Основа» имени файла без версии: fabric-api-0.116.7+1.21.1.jar → fabric-api */
function modStem(filename: string): string {
  const base = filename.replace(/\.disabled$/i, '').replace(/\.(jar|zip)$/i, '')
  const m = base.match(/^(.+?)[-_]v?\d/)
  return (m ? m[1] : base).toLowerCase()
}

/** Уже есть файл того же мода (любой версии) в папке? Чтобы не ставить зависимость дважды. */
function alreadyInstalled(dir: string, filename: string): boolean {
  const stem = modStem(filename)
  if (!stem) return false
  let files: string[]
  try { files = readdirSync(dir) } catch { return false }
  return files.some(f => /\.(jar|zip)(\.disabled)?$/i.test(f) && modStem(f) === stem)
}

/**
 * Ставит выбранный контент из браузера в сборку вместе с его обязательными зависимостями
 * (рекурсивно, с дедупликацией). Сам элемент кладётся в свою папку (mods/resourcepacks/shaderpacks),
 * а зависимости — всегда в mods (они моды, даже если ставится шейдер, которому нужен Iris).
 */
export async function installFromBrowser(
  source: string,
  type: string,
  projectId: string,
  refId: string,
  mcVersion: string,
  loader: string,
  packRoot: string,
  win: BrowserWindow
): Promise<{ ok: boolean; installed: string[]; error?: string }> {
  const modsDir = join(packRoot, 'mods')
  const mainDir = join(packRoot, FOLDER[type] ?? 'mods')
  const installed: string[] = []
  try {
    if (source === 'modrinth') {
      await walkModrinth(projectId, refId, true, type, mcVersion, loader, mainDir, modsDir, win, installed, new Set(), 0)
    } else {
      await walkCurseforge(Number(projectId), Number(refId), true, type, mcVersion, loader, mainDir, modsDir, win, installed, new Set(), 0)
    }
    return { ok: true, installed }
  } catch (e) {
    return { ok: false, installed, error: e instanceof Error ? e.message : String(e) }
  }
}

async function walkModrinth(
  projectId: string, versionId: string | null, isRoot: boolean, rootType: string,
  mc: string, loader: string, mainDir: string, modsDir: string,
  win: BrowserWindow, installed: string[], seen: Set<string>, depth: number
): Promise<void> {
  if (seen.has(projectId) || depth > MAX_DEPTH) return
  seen.add(projectId)

  let version: ModrinthVersion | null = null
  if (versionId) version = await getModrinthVersion(versionId)
  if (!version) {
    // Зависимость без пина (или корень без версии) — берём последнюю совместимую. Зависимости — это моды.
    const vers = await getModVersions(projectId, mc, loader, isRoot ? rootType : 'mod').catch(() => [] as ModrinthVersion[])
    version = vers[0] ?? null
  }
  if (!version) return

  const file = (version.files ?? []).find(f => f.primary) ?? version.files?.[0]
  if (!file) return
  // Зависимость уже установлена (пусть и другой версии) — оставляем её, дубль не ставим
  if (!isRoot && alreadyInstalled(modsDir, file.filename)) return
  await downloadModToDir(file.url, file.filename, isRoot ? mainDir : modsDir, win, file.hashes?.sha512)
  installed.push(file.filename)

  for (const dep of version.dependencies ?? []) {
    if (dep.dependency_type === 'required' && dep.project_id) {
      await walkModrinth(dep.project_id, dep.version_id ?? null, false, 'mod', mc, loader, mainDir, modsDir, win, installed, seen, depth + 1)
    }
  }
}

async function walkCurseforge(
  modId: number, fileId: number | null, isRoot: boolean, rootType: string,
  mc: string, loader: string, mainDir: string, modsDir: string,
  win: BrowserWindow, installed: string[], seen: Set<number>, depth: number
): Promise<void> {
  if (seen.has(modId) || depth > MAX_DEPTH) return
  seen.add(modId)

  const files = await getCurseforgeFiles(modId, mc, loader, isRoot ? rootType : 'mod').catch(() => [] as CfFile[])
  let file = fileId ? files.find(f => f.id === fileId) : undefined
  if (!file) file = files.find(f => f.downloadUrl)
  if (!file?.downloadUrl) return
  if (!isRoot && alreadyInstalled(modsDir, file.fileName)) return
  await downloadModToDir(file.downloadUrl, file.fileName, isRoot ? mainDir : modsDir, win, undefined, cfSha1(file))
  installed.push(file.fileName)

  for (const dep of file.dependencies ?? []) {
    if (dep.relationType === 3 && dep.modId) {
      await walkCurseforge(dep.modId, null, false, 'mod', mc, loader, mainDir, modsDir, win, installed, seen, depth + 1)
    }
  }
}
