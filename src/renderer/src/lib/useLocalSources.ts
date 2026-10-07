import { useState, useEffect, useRef, useCallback } from 'react'

type SourceMap = Record<string, string | null>

const CHUNK = 24

/**
 * Для локальных файлов (.jar/.zip без известного источника) определяет project_id Modrinth по хэшу.
 * Нужен, чтобы моды в локальных сборках тоже были кликабельны. sourceFor(filename) -> project_id | null | undefined.
 */
export function useLocalSources(dir: string, filenames: string[]): (filename: string) => string | null | undefined {
  const [sources, setSources] = useState<SourceMap>({})
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
          const map = await window.api.mods.resolveSources(dir, chunk)
          if (!alive.current) return
          setSources(p => ({ ...p, ...map }))
        } catch {
          chunk.forEach(f => requested.current.delete(f)) // позволим повторить позже
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dir])

  return useCallback((filename: string) => sources[filename], [sources])
}
