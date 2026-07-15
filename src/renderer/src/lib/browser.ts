// Общие типы для раздела «Браузер» (поиск/установка контента).

export type Source = 'modrinth' | 'curseforge'

/** Тип контента в браузере. */
export type ContentType = 'modpack' | 'mod' | 'resourcepack' | 'shader'

/** Устанавливаемый в сборку контент (без сборок). */
export type InstallableType = 'mod' | 'resourcepack' | 'shader'

/** Сборка как цель установки. */
export interface TargetPack {
  id: string
  name: string
  mc_version: string
  loader: string
}
