import { useState, useEffect, useRef, useCallback } from 'react'

type IconMod = { modrinth_id?: string; filename: string }
type IconMap = Record<string, string | null>

const CHUNK = 24

/** Грузит ключи пачками; каждая пачка сразу попадает в state. */
async function fetchChunked(
  keys: string[],
  requested: Set<string>,
  fetcher: (chunk: string[]) => Promise<IconMap>,
  apply: (m: IconMap) => void,
  alive: () => boolean
) {
  const todo = keys.filter(k => !requested.has(k))
  todo.forEach(k => requested.add(k))

  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK)
    try {
      const map = await fetcher(chunk)
      if (!alive()) return
      // null = «иконки нет», чтобы не спрашивать повторно
      apply(Object.fromEntries(chunk.map(k => [k, map[k] ?? null])))
    } catch {
      chunk.forEach(k => requested.delete(k)) // позволим повторить позже
    }
  }
}

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
  const [remote, setRemote] = useState<IconMap>({})
  const [local, setLocal] = useState<IconMap>({})
  const requestedRemote = useRef(new Set<string>())
  const requestedLocal = useRef(new Set<string>())
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  // Порядок как в списке — верхние строки получают иконки первыми
  const remoteIds = [...new Set(mods.map(m => m.modrinth_id).filter(Boolean) as string[])]
  const remoteKey = remoteIds.join(',')
  useEffect(() => {
    fetchChunked(
      remoteIds,
      requestedRemote.current,
      c => window.api.modrinth.icons(c) as Promise<IconMap>,
      m => setRemote(p => ({ ...p, ...m })),
      () => alive.current
    )
  }, [remoteKey])

  const localFiles = [...new Set(
    mods.filter(m => !m.modrinth_id && present.has(m.filename)).map(m => m.filename)
  )]
  const localKey = localFiles.join('|')
  useEffect(() => {
    if (!dir) return
    fetchChunked(
      localFiles,
      requestedLocal.current,
      c => window.api.mods.localIcons(dir, c) as Promise<IconMap>,
      m => setLocal(p => ({ ...p, ...m })),
      () => alive.current
    )
  }, [localKey, dir])

  return useCallback(
    (mod: IconMod) =>
      (mod.modrinth_id ? remote[mod.modrinth_id] : local[mod.filename]) || undefined,
    [remote, local]
  )
}