import { useState, useEffect } from 'react'

type IconMod = { modrinth_id?: string; filename: string }

/**
 * Иконки для списка контента (моды/ресурспаки/шейдеры).
 * Приоритет: иконка Modrinth по modrinth_id (один bulk-запрос на набор id);
 * иначе — локальная иконка из архива по filename (извлекается из .jar/.zip в main),
 * но только для того, что реально лежит на диске и не имеет modrinth_id (локальные и CF-only).
 * Возвращает функцию iconFor(mod) -> url|undefined.
 */
export function useContentIcons(
  dir: string,
  mods: IconMod[],
  present: Set<string>
): (mod: IconMod) => string | undefined {
  const [remote, setRemote] = useState<Record<string, string | null>>({})
  const [local, setLocal] = useState<Record<string, string | null>>({})

  const remoteKey = [...new Set(mods.map(m => m.modrinth_id).filter(Boolean) as string[])].sort().join(',')
  useEffect(() => {
    const ids = remoteKey ? remoteKey.split(',') : []
    if (!ids.length) return
    window.api.modrinth.icons(ids).then(map => setRemote(prev => ({ ...prev, ...map }))).catch(() => {})
  }, [remoteKey])

  const localKey = [...new Set(mods.filter(m => !m.modrinth_id && present.has(m.filename)).map(m => m.filename))]
    .sort().join('|')
  useEffect(() => {
    const files = localKey ? localKey.split('|') : []
    if (!files.length || !dir) return
    window.api.mods.localIcons(dir, files).then(map => setLocal(prev => ({ ...prev, ...map }))).catch(() => {})
  }, [localKey, dir])

  return (mod: IconMod): string | undefined =>
    (mod.modrinth_id ? remote[mod.modrinth_id] : local[mod.filename]) || undefined
}
