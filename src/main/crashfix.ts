import { join } from 'path'
import { createHash } from 'crypto'
import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync } from 'fs'
import { store, getPackMemory, setPackMemory } from './store'
import { fetchModpack } from './modpacks'
import { searchModrinth, getModVersions, getModrinthVersionByHash } from './modrinth'
import { downloadModToDir } from './installer'
import { matchModFile } from './modFiles'

interface Fix { kind: string; label?: string; query?: string; version?: string; mod?: string; file?: string }

/** Исполняет починку из диагноза краша. */
export async function applyCrashFix(modpackId: string, fix: Fix): Promise<{ ok: boolean; message?: string; error?: string }> {
  const modpack = await fetchModpack(modpackId)
  const installPath = store.get('installPath') as string
  const modsDir = join(installPath, modpackId, 'mods')

  // Установить недостающую/нужную зависимость с Modrinth
  if (fix.kind === 'install-dep') {
    if (!fix.query) return { ok: false, error: 'Неизвестно, что устанавливать' }
    const hits = (await searchModrinth(fix.query, modpack.mc_version, modpack.loader, 'mod')) as any[]
    if (!hits.length) return { ok: false, error: `На Modrinth не нашёл «${fix.query}»` }
    const proj = hits[0]
    const versions = (await getModVersions(proj.project_id, modpack.mc_version, modpack.loader, 'mod')) as any[]
    if (!versions.length) return { ok: false, error: `Нет версии «${proj.title}» под ${modpack.loader} ${modpack.mc_version}` }
    const v = versions[0] // новейшая совместимая
    const file = (v.files ?? []).find((f: any) => f.primary) ?? v.files?.[0]
    if (!file) return { ok: false, error: 'У версии нет файла для скачивания' }
    await downloadModToDir(file.url, file.filename, modsDir, undefined, file.hashes?.sha512)
    return { ok: true, message: `Установлен ${proj.title} ${v.version_number}` }
  }

  // Увеличить выделенную память (для ЭТОЙ сборки — память теперь per-пак)
  if (fix.kind === 'increase-ram') {
    const cur = getPackMemory(modpackId) || 4096
    const os = await import('os')
    const totalMb = Math.round(os.totalmem() / 1024 / 1024)
    const cap = Math.max(4096, totalMb - 2048) // оставляем ~2 ГБ системе
    const next = Math.min(cur + 2048, cap)
    if (next <= cur) return { ok: false, error: 'Память уже на максимуме для этой системы — закройте другие программы' }
    setPackMemory(modpackId, next)
    return { ok: true, message: `Память увеличена до ${(next / 1024).toFixed(1)} ГБ` }
  }

  // Обновить мод-виновник до свежей версии с Modrinth (файл опознаём по хэшу, старый удаляем)
  if (fix.kind === 'update-mod') {
    const name = fix.mod ?? fix.file ?? 'мод'
    const path = fix.file ? join(modsDir, fix.file) : ''
    if (!path || !existsSync(path)) return { ok: false, error: `Не нашёл файл мода «${name}» в папке модов` }
    const sha1 = createHash('sha1').update(readFileSync(path)).digest('hex')
    const cur = await getModrinthVersionByHash(sha1)
    if (!cur?.project_id) return { ok: false, error: `«${name}» не найден на Modrinth - обновите его вручную или отключите` }
    const versions = await getModVersions(cur.project_id, modpack.mc_version, modpack.loader, 'mod')
    // Только то, что новее установленного; из них релиз предпочитаем бете.
    const newer = versions.filter(v => v.id !== cur.id && (v.date_published ?? '') > (cur.date_published ?? ''))
    const next = newer.find(v => v.version_type === 'release') ?? newer[0]
    if (!next) {
      return { ok: false, error: `Уже стоит последняя версия «${name}» (${cur.version_number}) под ${modpack.loader} ${modpack.mc_version}. Остаётся отключить мод.` }
    }
    const file = (next.files ?? []).find(f => f.primary) ?? next.files?.[0]
    if (!file) return { ok: false, error: 'У новой версии нет файла для скачивания' }
    await downloadModToDir(file.url, file.filename, modsDir, undefined, file.hashes?.sha512)
    if (file.filename !== fix.file) unlinkSync(path)
    return { ok: true, message: `${name}: ${cur.version_number} → ${next.version_number}` }
  }

  // Отключить конфликтующий мод
  if (fix.kind === 'disable-mod') {
    if (!fix.mod) return { ok: false, error: 'Неизвестно, какой мод отключить' }
    if (!existsSync(modsDir)) return { ok: false, error: 'Папка модов не найдена' }
    // Точное имя файла из диагноза; без него - по названию, но только если файл определяется однозначно.
    const file = fix.file && existsSync(join(modsDir, fix.file)) ? fix.file : matchModFile(readdirSync(modsDir), fix.mod)
    if (!file) return { ok: false, error: `Не удалось однозначно найти файл мода «${fix.mod}» - отключите его во вкладке «Моды»` }
    renameSync(join(modsDir, file), join(modsDir, file + '.disabled'))
    return { ok: true, message: `Отключён ${file}` }
  }

  return { ok: false, error: 'Неизвестный тип починки' }
}
