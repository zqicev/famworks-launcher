import { readFileSync } from 'fs'
import { basename } from 'path'
import { getFile, putFile, deleteFile, ensureRelease, uploadAsset } from './github'
import { sha512 } from './hash'
import { store } from './store'
import { Modpack, ModpackIndex, ModpackSummary, LoadedModpack } from '../types/modpack'

const INDEX_PATH = 'modpacks/index.json'
const packPath = (id: string) => `modpacks/${id}.json`

function toSummary(m: Modpack): ModpackSummary {
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    mc_version: m.mc_version,
    loader: m.loader,
    loader_version: m.loader_version,
    updated_at: m.updated_at
  }
}

/** Загружает index.json и все сборки. */
export async function loadWorkspace(): Promise<{ packs: Record<string, LoadedModpack>; missing: string[] }> {
  const indexFile = await getFile(INDEX_PATH)
  const packs: Record<string, LoadedModpack> = {}
  const missing: string[] = []

  if (!indexFile) return { packs, missing }

  const index: ModpackIndex = JSON.parse(indexFile.content)
  for (const summary of index.modpacks ?? []) {
    const file = await getFile(packPath(summary.id))
    if (!file) { missing.push(summary.id); continue }
    packs[summary.id] = { data: JSON.parse(file.content), fileSha: file.sha }
  }
  return { packs, missing }
}

/** Сохраняет сборку: пишет <id>.json и обновляет index.json. Возвращает новый sha файла сборки. */
export async function saveModpack(modpack: Modpack, fileSha: string | null): Promise<{ fileSha: string }> {
  modpack.updated_at = new Date().toISOString()

  const json = JSON.stringify(modpack, null, 2) + '\n'
  const newSha = await putFile(packPath(modpack.id), json, `Обновлена сборка ${modpack.name}`, fileSha)

  // Обновляем index.json (берём свежий sha, чтобы не словить конфликт)
  const indexFile = await getFile(INDEX_PATH)
  let index: ModpackIndex = indexFile ? JSON.parse(indexFile.content) : { modpacks: [] }
  if (!Array.isArray(index.modpacks)) index.modpacks = []

  const summary = toSummary(modpack)
  const i = index.modpacks.findIndex(m => m.id === modpack.id)
  if (i >= 0) index.modpacks[i] = summary
  else index.modpacks.push(summary)

  const indexJson = JSON.stringify(index, null, 2) + '\n'
  await putFile(INDEX_PATH, indexJson, `index: ${modpack.name}`, indexFile?.sha ?? null)

  return { fileSha: newSha }
}

/** Удаляет сборку из репо и index.json. */
export async function deleteModpack(id: string, fileSha: string): Promise<void> {
  await deleteFile(packPath(id), `Удалена сборка ${id}`, fileSha)

  const indexFile = await getFile(INDEX_PATH)
  if (indexFile) {
    const index: ModpackIndex = JSON.parse(indexFile.content)
    index.modpacks = (index.modpacks ?? []).filter(m => m.id !== id)
    const indexJson = JSON.stringify(index, null, 2) + '\n'
    await putFile(INDEX_PATH, indexJson, `index: удалена ${id}`, indexFile.sha)
  }
}

/** Заливает локальный .jar в релиз модов, возвращает данные для записи в сборку. */
export async function uploadCustomJar(filePath: string): Promise<{
  filename: string; download_url: string; sha512: string; size_mb: number
}> {
  const data = readFileSync(filePath)
  const filename = basename(filePath)
  const hash = sha512(data)
  const tag = store.get('modsReleaseTag') as string
  const release = await ensureRelease(tag)
  const url = await uploadAsset(release, filename, data, 'application/java-archive')
  return {
    filename,
    download_url: url,
    sha512: hash,
    size_mb: Math.round((data.length / 1024 / 1024) * 10) / 10
  }
}

/** Заливает конфиг-файл в релиз. Имя ассета уникально по хэшу (нет коллизий одинаковых имён). */
export async function uploadConfig(filePath: string): Promise<{
  filename: string; download_url: string; sha512: string; suggestedPath: string
}> {
  const data = readFileSync(filePath)
  const filename = basename(filePath)
  const hash = sha512(data)
  const assetName = `cfg-${hash.slice(0, 12)}-${filename}`
  const tag = store.get('modsReleaseTag') as string
  const release = await ensureRelease(tag)
  const url = await uploadAsset(release, assetName, data, 'application/octet-stream')
  return {
    filename,
    download_url: url,
    sha512: hash,
    suggestedPath: `config/${filename}`
  }
}
