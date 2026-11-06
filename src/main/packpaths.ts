import { join, basename } from 'path'
import { existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { store } from './store'
import { Modpack } from '../types/modpack'

// ───────── Имя папки сборки ↔ её id ─────────
// Исторически папка сборки = её id (ASCII, напр. main-famrokia / custom-pack). Теперь папку можно
// назвать по-человечески (в т.ч. кириллицей: «Фамрокия»). Чтобы не ломать установленное, храним
// маппинг id → имя папки; резолвер по умолчанию отдаёт легаси-папку (installPath/<id>), пока маппинг
// не создан принудительной миграцией. Остальной код всегда ходит через packDir(id).

// Запрещённые в именах папок Windows символы (и управляющие). Кириллица/буквы/цифры/пробел/-/_ разрешены.
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g

// ───────── Поддержка кириллицы в путях ─────────
// Java на Windows читает classpath через системную ANSI-кодовую страницу (ACP = sun.jnu.encoding).
// Если ACP не умеет кириллицу (не 1251 и не UTF-8), путь к jar-никам коверкается и игра падает с
// ClassNotFoundException (fabric KnotClient и т.п.). Поэтому на таких машинах имя папки делаем
// латиницей (транслит), а на русских/UTF-8 — оставляем как есть («Фамрокия»). Определяется один раз.
let cyrillicPathsOk: boolean | null = null

function readAcp(): number {
  const key = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage'
  try {
    const out = execFileSync('reg', ['query', key, '/v', 'ACP'], { encoding: 'utf8', timeout: 5000, windowsHide: true })
    const m = out.match(/ACP\s+REG_SZ\s+(\d+)/i)
    if (m) return Number(m[1])
  } catch { /* ниже пробуем PowerShell */ }
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      "(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage').ACP"],
      { encoding: 'utf8', timeout: 8000, windowsHide: true })
    const n = Number(out.trim())
    if (n) return n
  } catch { /* не определили */ }
  return 0
}

/** Умеет ли система отображать кириллицу в путях (ACP 1251 или UTF-8). Кэшируется на сессию. */
export function systemSupportsCyrillicPaths(): boolean {
  if (cyrillicPathsOk !== null) return cyrillicPathsOk
  if (process.platform !== 'win32') { cyrillicPathsOk = true; return true } // mac/linux — пути UTF-8
  const acp = readAcp()
  // Не определили (0) → считаем, что не умеет: латиница запускается везде (безопасный дефолт).
  cyrillicPathsOk = acp === 1251 || acp === 65001
  return cyrillicPathsOk
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
}

/** Кириллица → латиница (для имён папок там, где кириллица в путях ломает запуск). */
function translit(s: string): string {
  return s.replace(/[а-яё]/gi, ch => {
    const t = TRANSLIT[ch.toLowerCase()] ?? ''
    return ch === ch.toLowerCase() ? t : t.charAt(0).toUpperCase() + t.slice(1)
  })
}

/** Имя папки из названия сборки: чистим запрещённое, обрезаем хвостовые точки/пробелы. '' — если пусто.
 *  Где кириллица в путях ломает запуск Java — переводим имя в латиницу (транслит + отброс не-ASCII). */
export function folderNameFromName(name: string): string {
  let n = name.replace(ILLEGAL, '').replace(/[.\s]+$/, '').trim()
  if (!systemSupportsCyrillicPaths()) {
    n = translit(n).replace(/[^\x20-\x7e]/g, '').replace(/[.\s]+$/, '').trim()
  }
  return n
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
 * Фиксирует имя папки сборки. НИКОГДА не двигает уже существующую папку с данными: переименование
 * установленной сборки — это риск потери миров/сохранений, поэтому мы его не делаем вовсе.
 * - Папка уже есть → фиксируем маппинг на неё (packDir всегда указывает на реальные данные).
 * - Папки ещё нет (свежая установка) → выбираем удобное имя (на не-кириллических системах — латиница,
 *   чтобы Java не падала на пути к jar-никам). Данные при этом не трогаются.
 * Возвращает актуальное имя папки.
 */
export function ensurePackFolder(modpack: Modpack): string {
  const installPath = store.get('installPath') as string
  if (!installPath) return packFolder(modpack.id)

  const mapped = folderMap()[modpack.id]
  // 1. Есть маппинг и папка по нему существует — это и есть папка с данными, используем её.
  if (mapped && existsSync(join(installPath, mapped))) return mapped
  // 2. Иначе — историческая легаси-папка (имя = id), если данные там. Фиксируем маппинг на неё.
  if (existsSync(join(installPath, modpack.id))) {
    setFolderMapping(modpack.id, modpack.id)
    return modpack.id
  }
  // 3. Маппинг есть, но папки по нему сейчас нет (и легаси нет) — НЕ плодим новую пустую папку,
  //    оставляем маппинг как есть: если пользователь вернёт папку на место, всё подхватится.
  if (mapped) return mapped
  // 4. Действительно свежая установка — выбираем удобное имя (на не-кириллических системах — латиница).
  const desired = folderNameFromName(modpack.name) || modpack.id
  setFolderMapping(modpack.id, desired)
  return desired
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
