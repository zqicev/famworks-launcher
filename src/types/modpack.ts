export interface ModpackSummary {
  id: string
  name: string
  description: string
  mc_version: string
  loader: 'fabric' | 'forge' | 'neoforge' | 'quilt' | 'vanilla'
  loader_version: string
  updated_at: string
}

export interface ModpackIndex {
  modpacks: ModpackSummary[]
}

export interface Mod {
  id: string
  name: string
  modrinth_id?: string
  /** Если задано — берётся именно эта версия Modrinth (а не последняя). Иначе — последняя совместимая. */
  modrinth_version_number?: string
  curseforge_id?: number
  filename: string
  version: string
  category: string
  size_mb: number
  required: boolean
  download_url?: string
  /** sha512 в hex (Modrinth / Get-FileHash). */
  sha512?: string
  /** sha1 в hex (CurseForge). Проверяется если нет sha512. */
  sha1?: string
}

export interface ChangelogEntry {
  version: string
  description: string
}

export interface ServerEntry {
  name: string
  ip: string        // хост (без порта)
  port?: number     // по умолчанию 25565
}

export interface ConfigFile {
  path: string          // путь назначения относительно папки игры, напр "config/sodium.json" или "options.txt"
  download_url: string
  sha512?: string
  overwrite?: boolean   // true — всегда перезаписывать, иначе только если файла нет
  extract?: boolean     // download_url — zip-архив: распаковать в корень сборки (структура папок сохраняется), архив удалить
}

// Доп. 3D-объект на сцене (glTF/GLB из Blockbench со своими анимациями — пчела, питомец, декор).
export interface SceneObject {
  url: string         // URL к .glb/.gltf (http(s) или data:); анимации проигрываются из самого файла
  scale?: number      // множитель масштаба, если единицы экспорта не совпадают с ригом (по умолчанию 1)
}

// Анимация 3D-модельки игрока на экране «Обзор» (Blockbench .animation.json) + доп. объекты сцены.
export interface CharacterAnim {
  idle?: string       // URL к .animation.json для idle-анимации; иначе встроенная idle
  idle_data?: string  // инлайн-содержимое .animation.json (для локальных сборок; приоритетнее idle)
  idle_name?: string  // имя анимации внутри файла (если несколько); иначе берётся первая
  objects?: SceneObject[] // доп. glTF-объекты сцены со своими анимациями (устар. — см. scene)
  // Единая сцена: один экспорт Blockbench (.glb/.gltf, URL или data:) с игроком + объектами + анимациями.
  // Если задан — рендерится как единая сцена (SceneStage), а текстура игрока подменяется скином аккаунта.
  scene?: string
}

export interface Modpack extends ModpackSummary {
  fabric_api_version: string
  long_description: string
  changelog: ChangelogEntry[]
  mods: Mod[]
  resourcepacks?: Mod[]   // та же форма, что у мода; ставятся в resourcepacks/
  shaders?: Mod[]         // ставятся в shaderpacks/
  servers?: ServerEntry[]
  configs?: ConfigFile[]
  character?: CharacterAnim  // анимация модельки на «Обзоре»
}
