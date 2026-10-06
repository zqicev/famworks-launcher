import { Mod } from '../../../types/modpack'

export type ModSource = 'modrinth' | 'curseforge' | 'famworks' | 'local'

export const SOURCE_LABEL: Record<ModSource, string> = {
  modrinth: 'Modrinth',
  curseforge: 'CurseForge',
  famworks: 'FamWorks',
  local: 'Локальный'
}

/** Откуда мод/пак/шейдер: по заданному источнику в сборке. */
export function modSource(mod: Mod): ModSource {
  if (mod.modrinth_id) return 'modrinth'
  if (mod.curseforge_id) return 'curseforge'
  if (mod.famworks_id) return 'famworks'
  return 'local'
}

/** Ссылка на страницу проекта (Modrinth/CurseForge). null — некуда вести (FamWorks/локальный). */
export function projectUrl(mod: Mod, type: 'mod' | 'resourcepack' | 'shader'): string | null {
  // Modrinth принимает id в типизированном пути и редиректит на slug.
  if (mod.modrinth_id) return `https://modrinth.com/${type}/${mod.modrinth_id}`
  // /projects/<id> редиректит на страницу проекта CurseForge.
  if (mod.curseforge_id) return `https://www.curseforge.com/projects/${mod.curseforge_id}`
  return null
}
