// Общий slug для id/имени папки локальной сборки. Папка = id, а кириллица в пути ломает запуск игры
// (краш в драйвере GPU), поэтому имя ВСЕГДА приводим к ASCII: сначала транслит кириллицы, затем чистим.

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  // распространённые украинские/белорусские
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u'
}

/** Имя -> ASCII-slug: транслит кириллицы, нижний регистр, только [a-z0-9-]. Пусто -> ''. */
export function slugify(name: string): string {
  const translit = name.toLowerCase().split('').map(c => CYRILLIC[c] ?? c).join('')
  return translit.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

/** id локальной сборки из имени: custom-<slug> (без слага — custom-pack). Без суффикса уникальности. */
export function baseCustomId(name: string): string {
  return `custom-${slugify(name) || 'pack'}`
}

/** Делает id уникальным среди used: base, base-2, base-3, ... */
export function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}
