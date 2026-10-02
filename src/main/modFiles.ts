// Имена файлов модов: как понять, что два файла - разные версии одного мода.

const MOD_FILE_RE = /\.(jar|zip)(\.disabled)?$/i

/** «Основа» имени файла без версии: fabric-api-0.116.7+1.21.1.jar → fabric-api */
export function modStem(filename: string): string {
  const base = filename.replace(/\.disabled$/i, '').replace(/\.(jar|zip)$/i, '')
  const m = base.match(/^(.+?)[-_]v?\d/)
  return (m ? m[1] : base).toLowerCase()
}

/** Имя файла без суффикса .disabled, в нижнем регистре - для сравнения. */
export function fileKey(filename: string): string {
  return filename.replace(/\.disabled$/i, '').toLowerCase()
}

/**
 * Файл мода по его названию или id («flashback» → Flashback-0.39.5-for-MC1.21.1.jar).
 * Слово может входить и в имена дополнений к моду (flashback-cameramocap-…): если похожих файлов несколько,
 * берём тот, чьё имя без версии совпадает целиком, иначе не гадаем.
 */
export function matchModFile(files: string[], name: string): string | undefined {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const slug = norm(name)
  if (slug.length < 3) return undefined
  const cands = files.filter(f => f.toLowerCase().endsWith('.jar') && norm(f).includes(slug))
  if (cands.length === 1) return cands[0]
  const exact = cands.filter(f => norm(modStem(f)) === slug)
  return exact.length === 1 ? exact[0] : undefined
}

/** Другие версии того же мода среди файлов папки (включённые и .disabled), кроме самого filename. */
export function otherVersions(files: string[], filename: string): string[] {
  const stem = modStem(filename)
  if (stem.length < 3) return [] // слишком короткая основа - совпадение ненадёжно
  const self = fileKey(filename)
  return files.filter(f => MOD_FILE_RE.test(f) && modStem(f) === stem && fileKey(f) !== self)
}
