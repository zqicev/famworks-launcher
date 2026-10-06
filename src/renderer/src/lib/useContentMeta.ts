import { useState, useEffect, useRef, useCallback } from 'react'

export type ContentMeta = { author: string | null; version: string | null }
type MetaMap = Record<string, ContentMeta>

const CHUNK = 24

/**
 * Автор/версия из архивов (.jar/.zip) для строк контента. Читает только те файлы,
 * что реально лежат на диске (переданы в filenames); тянет пачками, каждая сразу в state.
 * Возвращает metaFor(filename) -> {author, version} | undefined.
 */
export function useContentMeta(dir: string, filenames: string[]): (filename: string) => ContentMeta | undefined {
  const [meta, setMeta] = useState<MetaMap>({})
  const requested = useRef(new Set<string>())
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const files = [...new Set(filenames.filter(Boolean))]
  const key = files.join('|')
  useEffect(() => {
    if (!dir) return
    const todo = files.filter(f => !requested.current.has(f))
    todo.forEach(f => requested.current.add(f))
    void (async () => {
      for (let i = 0; i < todo.length; i += CHUNK) {
        const chunk = todo.slice(i, i + CHUNK)
        try {
          const map = await window.api.mods.localMeta(dir, chunk)
          if (!alive.current) return
          setMeta(p => ({ ...p, ...map }))
        } catch {
          chunk.forEach(f => requested.current.delete(f)) // позволим повторить позже
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dir])

  return useCallback((filename: string) => meta[filename], [meta])
}
