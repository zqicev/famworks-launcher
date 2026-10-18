import { join, basename } from 'path'
import { existsSync, renameSync } from 'fs'
import { store } from './store'
import { Modpack } from '../types/modpack'
import { instancesForPack } from './instances'

// ───────── Имя папки сборки ↔ её id ─────────
// Исторически папка сборки = её id (ASCII, напр. main-famrokia / custom-pack). Теперь папку можно
// назвать по-человечески (в т.ч. кириллицей: «Фамрокия»). Чтобы не ломать установленное, храним
// маппинг id → имя папки; резолвер по умолчанию отдаёт легаси-папку (installPath/<id>), пока маппинг
// не создан принудительной миграцией. Остальной код всегда ходит через packDir(id).

// Запрещённые в именах папок Windows символы (и управляющие). Кириллица/буквы/цифры/пробел/-/_ разрешены.
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g

/** Имя папки из названия сборки: чистим запрещённое, обрезаем хвостовые точки/пробелы. '' — если пусто. */
export function folderNameFromName(name: string): string {
  return name.replace(ILLEGAL, '').replace(/[.\s]+$/, '').trim()
}

function folderMap(): Record<string, string> {
  return (store.get('packFolders') as Record<string, string> | undefined) ?? {}
}
function setFolderMapping(id: string, folder: string): void {
  const m = folderMap()
  m[id] = folder
  store.set('packFolders', m)
}

/** Имя папки сборки (относительно installPath). Приоритет: маппинг → легаси-папка (id) → id. */
export function packFolder(id: string): string {
  const mapped = folderMap()[id]
  if (mapped) return mapped
  return id // легаси и дефолт — папка называется как id
}

/** Абсолютный путь к папке сборки. По умолчанию installPath/<id> (как раньше). */
export function packDir(id: string): string {
  const installPath = store.get('installPath') as string
  return join(installPath, packFolder(id))
}

/**
 * Принудительно приводит папку сборки к человекочитаемому имени (можно кириллицей).
 * Безопасно: переименовывает ТОЛЬКО если имя отличается, целевой папки ещё нет, сборка не запущена,
 * и операция прошла без ошибки. Иначе оставляет как есть (легаси). Идемпотентно.
 * Возвращает актуальное имя папки.
 */
export function ensurePackFolder(modpack: Modpack): string {
  const installPath = store.get('installPath') as string
  if (!installPath) return packFolder(modpack.id)

  const current = packFolder(modpack.id) // что сейчас (маппинг/легаси)
  const desired = folderNameFromName(modpack.name) || modpack.id
  if (desired === current) {
    // Уже как надо — зафиксируем маппинг (если был чистый легаси), чтобы дальше не пересчитывать.
    if (!folderMap()[modpack.id]) setFolderMapping(modpack.id, current)
    return current
  }

  const currentPath = join(installPath, current)
  const desiredPath = join(installPath, desired)

  // Папка ещё не создана (сборка не устанавливалась) — просто фиксируем желаемое имя.
  if (!existsSync(currentPath)) { setFolderMapping(modpack.id, desired); return desired }

  // Нельзя переименовывать запущенную сборку или если целевая папка уже занята.
  if (instancesForPack(modpack.id).length > 0) return current
  if (existsSync(desiredPath)) return current

  try {
    renameSync(currentPath, desiredPath)
    setFolderMapping(modpack.id, desired)
    return desired
  } catch {
    return current // занято/нет прав — остаёмся на легаси, попробуем позже
  }
}

/** Папка сборки удалена (при удалении сборки) — чистим маппинг. */
export function forgetPackFolder(id: string): void {
  const m = folderMap()
  if (m[id] !== undefined) { delete m[id]; store.set('packFolders', m) }
}

/** Имя папки (basename) для прикрепления к модпаку, чтобы рендер строил пути по нему, а не по id. */
export function packFolderOf(id: string): string {
  return basename(packDir(id))
}
