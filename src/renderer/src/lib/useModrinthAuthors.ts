import { useState, useEffect, useRef, useCallback } from 'react'

export type Author = { author: string | null; avatar: string | null }
type AuthorMap = Record<string, Author>

const CHUNK = 12

/**
 * Автор (владелец проекта) и его аватар с Modrinth по project_id.
 * Паттерн как у useContentIcons: dedup через requested, проверка alive.current
 * после await (переживает двойной маунт React.StrictMode). authorFor(id) -> {author, avatar} | undefined.
 */
export function useModrinthAuthors(ids: (string | undefined)[]): (id: string) => Author | undefined {
  const [authors, setAuthors] = useState<AuthorMap>({})
  const requested = useRef(new Set<string>())
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const list = [...new Set(ids.filter(Boolean) as string[])]
  const key = list.join(',')
  useEffect(() => {
    const todo = list.filter(id => !requested.current.has(id))
    todo.forEach(id => requested.current.add(id))
    void (async () => {
      for (let i = 0; i < todo.length; i += CHUNK) {
        const chunk = todo.slice(i, i + CHUNK)
        try {
          const map = await window.api.modrinth.authors(chunk)
          if (!alive.current) return
          setAuthors(p => ({ ...p, ...map }))
        } catch {
          chunk.forEach(id => requested.current.delete(id)) // позволим повторить позже
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return useCallback((id: string) => authors[id], [authors])
}
