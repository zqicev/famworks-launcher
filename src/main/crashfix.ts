import { join } from 'path'
import { existsSync, readdirSync, renameSync } from 'fs'
import { store } from './store'
import { fetchModpack } from './modpacks'
import { searchModrinth, getModVersions } from './modrinth'
import { downloadModToDir } from './installer'

interface Fix { kind: string; label?: string; query?: string; version?: string; mod?: string }

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

  // Увеличить выделенную память
  if (fix.kind === 'increase-ram') {
    const cur = (store.get('allocatedMemory') as number) || 4096
    const os = await import('os')
    const totalMb = Math.round(os.totalmem() / 1024 / 1024)
    const cap = Math.max(4096, totalMb - 2048) // оставляем ~2 ГБ системе
    const next = Math.min(cur + 2048, cap)
    if (next <= cur) return { ok: false, error: 'Память уже на максимуме для этой системы — закройте другие программы' }
    store.set('allocatedMemory', next)
    return { ok: true, message: `Память увеличена до ${(next / 1024).toFixed(1)} ГБ` }
  }

  // Отключить конфликтующий мод
  if (fix.kind === 'disable-mod') {
    if (!fix.mod) return { ok: false, error: 'Неизвестно, какой мод отключить' }
    if (!existsSync(modsDir)) return { ok: false, error: 'Папка модов не найдена' }
    const slug = fix.mod.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const file = readdirSync(modsDir).find(f =>
      f.toLowerCase().endsWith('.jar') && slug.length >= 3 && f.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(slug)
    )
    if (!file) return { ok: false, error: `Не нашёл файл мода «${fix.mod}» в папке модов` }
    renameSync(join(modsDir, file), join(modsDir, file + '.disabled'))
    return { ok: true, message: `Отключён ${file}` }
  }

  return { ok: false, error: 'Неизвестный тип починки' }
}
