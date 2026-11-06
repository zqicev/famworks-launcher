import { app } from 'electron'
import { dirname, resolve, relative, isAbsolute } from 'path'

// Путь установки сборок НЕ должен быть внутри папки самого лаунчера: обновление (electron-updater/NSIS)
// переписывает папку программы и стирает всё, что в ней лежит, включая миры и моды. Здесь — безопасный
// дефолт и проверка выбранного пути.

/** Папка, куда установлен сам лаунчер (в собранном виде). В dev — пусто (гард не применяем). */
export function appInstallDir(): string {
  return app.isPackaged ? dirname(process.execPath) : ''
}

/** Безопасный путь по умолчанию для сборок — вне папки программы, переживает обновления. */
export function defaultInstallPath(): string {
  const base = process.env.LOCALAPPDATA || app.getPath('userData')
  return resolve(base, 'FamWorks', 'instances')
}

function norm(p: string): string {
  const r = resolve(p)
  return process.platform === 'win32' ? r.toLowerCase() : r
}

/** true, если child лежит внутри parent (или совпадает с ним). */
function isInside(child: string, parent: string): boolean {
  if (!parent) return false
  const rel = relative(norm(parent), norm(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Проверка пути установки сборок. ok:false + причина, если путь опасен. */
export function validateInstallPath(p: string): { ok: boolean; reason?: string } {
  const path = (p || '').trim()
  if (!path) return { ok: false, reason: 'Папка не выбрана' }

  const appDir = appInstallDir()
  // Папка лаунчера (или вложенная/родительская к ней) — обновление её переписывает и стирает данные.
  if (appDir && (isInside(path, appDir) || isInside(appDir, path))) {
    return {
      ok: false,
      reason: 'Нельзя устанавливать сборки в папку лаунчера - обновление удалит все файлы. Выберите отдельную папку.'
    }
  }
  // Program Files — права администратора и переписывается установщиками.
  const pf = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean) as string[]
  if (pf.some((d) => isInside(path, d))) {
    return {
      ok: false,
      reason: 'Program Files не подходит - нужны права администратора и путь переписывается. Выберите папку в своём профиле или на игровом диске.'
    }
  }
  return { ok: true }
}
