import Store from 'electron-store'
import { Modpack } from '../types/modpack'

export interface Account {
  id: string                    // 'offline:<ник>' | 'msa:<uuid>' | 'ely:<uuid>'
  username: string
  type: 'offline' | 'microsoft' | 'ely'
  uuid?: string                 // для microsoft/ely
  refreshToken?: string         // для microsoft
  accessToken?: string          // для ely (Yggdrasil)
  clientToken?: string          // для ely (нужен при refresh)
  customSkins?: boolean         // офлайн: скины по нику (TLauncher/Ely.by) через CustomSkinLoader
}

interface StoreSchema {
  installPath: string
  accounts: Account[]
  activeAccountId: string | null
  allocatedMemory: number        // общий дефолт ОЗУ (используется для сборок без своего значения)
  packMemory: Record<string, number> // ОЗУ per-пак: { [modpackId]: МБ }
  // Запущенные экземпляры игры (их может быть несколько). Переживает перезапуск лаунчера: при старте
  // отсеиваем мёртвые pid (см. reattachInstances).
  runningInstances: { instanceId: string; modpackId: string; modpackName: string; account: string; pid: number; startedAt: number }[]
  portalToken?: string           // токен привязки к порталу FamWorks (safeStorage-шифртекст, base64)
  // Выбор ветки test/release для famworks-модов, per-сборка: { [packId]: { [famworks_id]: 'test'|'release' } }
  famworksChannels?: Record<string, Record<string, string>>
  customModpacks: Modpack[]
  // Статистика запусков миров/серверов для сортировки «Продолжить игру»:
  // { [modpackId]: { 'w:<folder>' | 's:<ip>': { count, last } } }
  playStats: Record<string, Record<string, { count: number; last: number }>>
  // Режим разработчика (инструменты мододела)
  devMode: boolean
  ideaPath: string // путь к idea64.exe для «Открыть в IntelliJ»
  jbrPath: string // путь к java.exe из JetBrains Runtime (для hot-swap); авто из IntelliJ, если пусто
  devSettings: Record<string, { debug?: boolean; port?: number; projectPath?: string; lastJar?: string; hotswap?: boolean }>
  // Резервные копии сборок. backupEnabled по умолчанию включено (undefined = вкл). backupDir — своя
  // папка для копий (пусто = дефолт в userData).
  backupDir?: string
  // Общий (мастер) переключатель автосохранения для всех сборок. Отсутствие = включено.
  backupAutoGlobal?: boolean
  // Пользователя уже спрашивали при первом запуске про автосохранение (модалка показывается один раз).
  backupAskDone?: boolean
  // Плашку «автосохранение выключено» пользователь скрыл. Сбрасывается при включении мастера.
  backupWarnDismissed?: boolean
  // Автосохранение на сборку: { packId: вкл/выкл }. Отсутствие = включено. Работает поверх мастера.
  backupAuto?: Record<string, boolean>
  // Какие категории авто-сохранять для сборки: { packId: ['worlds','mods',…] }. Отсутствие = всё.
  backupAutoCats?: Record<string, string[]>
  // Имя папки копий для сборки: { packId: имя }. Папку называем по названию сборки, а не по id.
  backupFolders?: Record<string, string>
  // Последние известные удалённые флаги (кэш на случай «нет сети» при запуске).
  flagsCache?: Record<string, unknown>
  // Кэш резолва модов для бэкапов (имя|размер|mtime → источник), чтобы не перехешивать каждый раз.
  modResolveCache?: Record<string, unknown>
}

export const store = new Store<StoreSchema>({
  defaults: {
    installPath: '',
    accounts: [],
    activeAccountId: null,
    allocatedMemory: 4096,
    packMemory: {},
    runningInstances: [],
    customModpacks: [],
    playStats: {},
    devMode: false,
    ideaPath: '',
    jbrPath: '',
    devSettings: {}
  }
})

/** ОЗУ (МБ) для конкретной сборки: своё значение, иначе общий дефолт allocatedMemory. */
export function getPackMemory(id: string): number {
  const map = (store.get('packMemory') as Record<string, number>) ?? {}
  return map[id] ?? (store.get('allocatedMemory') as number) ?? 4096
}

/** Сохраняет ОЗУ (МБ) для конкретной сборки. */
export function setPackMemory(id: string, mb: number): void {
  const map = { ...((store.get('packMemory') as Record<string, number>) ?? {}) }
  map[id] = mb
  store.set('packMemory', map)
}
