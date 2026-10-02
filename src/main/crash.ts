import { join, dirname, basename } from 'path'
import { existsSync, readdirSync, statSync, readFileSync, openSync, readSync, closeSync } from 'fs'
import { Modpack } from '../types/modpack'
import { getFamworksTracking } from './installer'
import {
  ModJar, MixinFailure, LINKAGE_RE, extractCrashTrace, parseTrace, missingClass, scanMods, loadedMods, activeMods,
  modOfFrames, ownerOfClass, ownerByPackage, parseMixinFailure, modOfMixin
} from './crashTrace'

export type CrashCategory = 'dependency' | 'conflict' | 'memory' | 'java' | 'mod-bug' | 'unknown'

// Дескриптор возможной починки (исполнение — Фаза 2)
export type CrashFix =
  | { kind: 'install-dep'; label: string; query: string; version?: string }
  | { kind: 'increase-ram'; label: string }
  | { kind: 'disable-mod'; label: string; mod: string; file?: string }
  | { kind: 'update-mod'; label: string; mod: string; file: string }

export interface Diagnosis {
  category: CrashCategory
  title: string
  detail: string
  culprit?: string
  reportPath?: string
  copyText: string
  fixes?: CrashFix[] // варианты решения, первый - предпочтительный
}

// Пакеты ванилы/загрузчиков/библиотек — не считаем их виновником
const VANILLA_PKG = /^(net\.minecraft|com\.mojang|java|javax|jdk|sun|net\.fabricmc|org\.quiltmc|org\.spongepowered|cpw\.mods|net\.neoforged|net\.minecraftforge|io\.netty|org\.lwjgl|oshi|com\.google|it\.unimi|org\.apache|org\.slf4j|joptsimple)\b/
const GAME_PKG = /^(net\.minecraft|com\.mojang)\./

function findCrashReport(gameRoot: string, sinceMs: number): { path: string; text: string } | null {
  const dir = join(gameRoot, 'crash-reports')
  if (!existsSync(dir)) return null
  const cand = readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.txt'))
    .map(f => { const p = join(dir, f); return { p, m: statSync(p).mtimeMs } })
    .filter(x => x.m >= sinceMs - 3000) // созданный в этой сессии
    .sort((a, b) => b.m - a.m)
  if (!cand[0]) return null
  try { return { path: cand[0].p, text: readFileSync(cand[0].p, 'utf8') } } catch { return null }
}

/** Пытается назвать мод-виновника: строка «Suspected Mods» (Forge/NeoForge) или первый не-ванильный пакет в стеке. */
function suspectFromStack(text: string): string | undefined {
  const sm = text.match(/Suspected Mod(?:\(s\)|s)?:\s*(.+)/i)
  if (sm && !/^none/i.test(sm[1].trim())) return sm[1].trim().replace(/\s*\(.*$/, '')
  for (const line of text.split(/\r?\n/)) {
    const a = line.match(/^\s*at\s+([a-z][a-zA-Z0-9_]*(?:\.[a-z][a-zA-Z0-9_]*){2,})/)
    if (a && !VANILLA_PKG.test(a[1])) return a[1].split('.').slice(0, 3).join('.')
  }
  return undefined
}

/** logs/latest.log этой сессии (в хвосте вывода 8000 символов - длинный стек и список модов туда не влезают). */
function readLatestLog(gameRoot: string, sinceMs: number): string {
  const p = join(gameRoot, 'logs', 'latest.log')
  try {
    const st = statSync(p)
    if (st.mtimeMs < sinceMs - 3000) return ''
    const MAX = 8 * 1024 * 1024
    if (st.size <= MAX) return readFileSync(p, 'utf8')
    // Огромный лог: шапка (список модов) + конец (падение)
    const fd = openSync(p, 'r')
    try {
      const head = Buffer.alloc(512 * 1024)
      const tail = Buffer.alloc(4 * 1024 * 1024)
      readSync(fd, head, 0, head.length, 0)
      readSync(fd, tail, 0, tail.length, st.size - tail.length)
      return head.toString('utf8') + '\n' + tail.toString('utf8')
    } finally { closeSync(fd) }
  } catch {
    return ''
  }
}

const modLabel = (j: ModJar): string => (j.version && !j.name.includes(j.version) ? `${j.name} ${j.version}` : j.name)

/** Что можно сделать с модом-виновником: обновить (если его версию не диктует сборка) или отключить. */
function modFixes(modpack: Modpack, gameRoot: string, jar: ModJar): CrashFix[] {
  let managed = modpack.mods.some(m => m.filename === jar.file)
  try {
    managed ||= Object.values(getFamworksTracking(dirname(gameRoot), basename(gameRoot))).some(t => t.filename === jar.file)
  } catch { /* нет трекинга */ }
  const fixes: CrashFix[] = []
  if (!managed) fixes.push({ kind: 'update-mod', label: `Обновить ${jar.name}`, mod: jar.name, file: jar.file })
  fixes.push({ kind: 'disable-mod', label: `Отключить ${jar.name}`, mod: jar.name, file: jar.file })
  return fixes
}

const fixAdvice = (jar: ModJar, fixes: CrashFix[]): string => (fixes.some(f => f.kind === 'update-mod')
  ? `Обновите ${jar.name} или отключите его.`
  : `Версию ${jar.name} задаёт сборка - отключите его или дождитесь обновления сборки.`)

type PartialDiagnosis = Omit<Diagnosis, 'copyText' | 'reportPath'>

/** Всё, что нужно диагнозам «по модам»: стек падения и (лениво, один раз) оглавления jar из mods. */
interface CrashCtx {
  modpack: Modpack
  gameRoot: string
  trace: string // стек упавшего исключения; '' - явного падения не нашли
  mods: () => Promise<{ all: ModJar[]; active: ModJar[] }> // active - без дублей, которые загрузчик проигнорировал
}

function makeCtx(modpack: Modpack, gameRoot: string, reportText: string, logTail: string, spawnedAt: number): CrashCtx {
  const log = readLatestLog(gameRoot, spawnedAt)
  const trace = extractCrashTrace(reportText) || extractCrashTrace(logTail) || extractCrashTrace(log)
  let scan: Promise<{ all: ModJar[]; active: ModJar[] }> | null = null
  const mods = (): Promise<{ all: ModJar[]; active: ModJar[] }> => (scan ??= scanMods(join(gameRoot, 'mods'))
    .then(all => ({ all, active: activeMods(all, loadedMods(log || logTail)) })))
  return { modpack, gameRoot, trace, mods }
}

/** Мод не смог встроиться (mixin) в код игры или другого мода: кто именно и во что. */
async function diagnoseMixin(ctx: CrashCtx, mixin: MixinFailure): Promise<PartialDiagnosis> {
  const { active } = await ctx.mods()
  const culprit = modOfMixin(mixin, active)
  if (!culprit) {
    // Файл мода не нашли (он вложен в другой мод или лежит вне mods) - называем по ошибке, кнопок не предлагаем.
    const mod = mixin.modId ?? (mixin.config ?? 'мод').replace(/\.mixins\.json$/i, '')
    return {
      category: 'conflict',
      title: 'Конфликт мода (mixin)',
      detail: `Мод «${mod}» не смог применить свои изменения - обычно это несовместимость с версией игры или с другим модом. `
        + `Отдельного файла этого мода в папке mods нет - скорее всего он входит в состав другого мода.`,
      culprit: mod
    }
  }
  const label = modLabel(culprit)
  const fixes = modFixes(ctx.modpack, ctx.gameRoot, culprit)
  const advice = fixAdvice(culprit, fixes)
  const owner = mixin.target && !GAME_PKG.test(mixin.target) ? ownerByPackage(mixin.target, active) : undefined
  if (owner && owner !== culprit) {
    return {
      category: 'conflict',
      title: `${culprit.name} несовместим с ${owner.name}`,
      detail: `Мод «${label}» встраивается в код мода «${owner.name}» и не нашёл там того, что ожидал. `
        + `Обычно это значит, что ${culprit.name} рассчитан на другую версию ${owner.name}${owner.version ? ` (установлена ${owner.version})` : ''}. ${advice}`,
      culprit: label,
      fixes
    }
  }
  return {
    category: 'conflict',
    title: `${culprit.name} не смог встроиться в игру`,
    detail: `Мод «${label}» не смог применить свои изменения к коду игры - обычно это несовместимость с версией игры `
      + `или с другим модом, который меняет то же место. ${advice}`,
    culprit: label,
    fixes
  }
}

/** Диагноз по стеку падения: какой мод упал и, если он не нашёл чужой код, - чей именно. */
async function diagnoseFromTrace(ctx: CrashCtx): Promise<PartialDiagnosis | null> {
  const { modpack, gameRoot, trace } = ctx
  if (!trace) return null
  const { type, message, rootFrames, frames } = parseTrace(trace)

  const { all, active } = await ctx.mods()
  const culprit = modOfFrames(rootFrames, active) ?? modOfFrames(frames, active)
  if (!culprit) return null
  const label = modLabel(culprit)
  const fixes = modFixes(modpack, gameRoot, culprit)
  const advice = fixAdvice(culprit, fixes)

  const missing = LINKAGE_RE.test(type) ? missingClass(type, message) : null
  if (missing && GAME_PKG.test(missing)) {
    return {
      category: 'conflict',
      title: `${culprit.name} не подходит к этой версии игры`,
      detail: `Мод «${label}» обращается к коду Minecraft, которого нет в версии ${modpack.mc_version} - скорее всего он собран под другую версию игры. ${advice}`,
      culprit: label,
      fixes
    }
  }
  if (missing) {
    const owner = ownerByPackage(missing, active)
    if (owner && owner !== culprit) {
      // Дубль того же мода другой версии, в котором этот класс есть - прямое подтверждение причины.
      const path = missing.replace(/\./g, '/') + '.class'
      const had = all.find(j => j.id === owner.id && j !== owner && j.classes.has(path))
      return {
        category: 'conflict',
        title: `${culprit.name} несовместим с ${owner.name}`,
        detail: `Мод «${label}» обращается к коду мода «${owner.name}», которого нет в установленной версии${owner.version ? ` ${owner.version}` : ''}. `
          + `Обычно это значит, что ${culprit.name} рассчитан на другую версию ${owner.name}.`
          + (had?.version ? ` В ${owner.name} ${had.version} этот код ещё был.` : '')
          + ` ${advice}`,
        culprit: label,
        fixes
      }
    }
    if (!owner) {
      return {
        category: 'conflict',
        title: `${culprit.name}: не хватает другого мода`,
        detail: `Мод «${label}» обращается к коду, которого нет в сборке (${missing.split('.').slice(0, 4).join('.')}). `
          + `Скорее всего ему нужен дополнительный мод или другая его версия. ${advice}`,
        culprit: label,
        fixes
      }
    }
  }
  // Мод часто сам объясняет причину в тексте ошибки - показываем его как есть.
  const said = message.trim() ? ` Сообщение ошибки: «${message.trim().slice(0, 200)}».` : ''

  // Ошибка в коде, который виновник встроил (mixin) в класс другого мода - скорее всего не сошлись их версии.
  const host = frames.filter(f => f.mixinMod === culprit.id).map(f => ownerOfClass(f.cls, active)).find(o => o && o !== culprit)
  if (host) {
    return {
      category: 'conflict',
      title: `${culprit.name} несовместим с ${host.name}`,
      detail: `Ошибка произошла в коде, который мод «${label}» встраивает в мод «${host.name}»`
        + `${host.version ? ` (установлена версия ${host.version})` : ''} - скорее всего он рассчитан на другую версию ${host.name}.${said} ${advice}`,
      culprit: label,
      fixes
    }
  }
  return {
    category: 'mod-bug',
    title: 'Ошибка в моде',
    detail: `Игра упала из-за ошибки в моде «${label}».${said} ${advice}`,
    culprit: label,
    fixes
  }
}

/** Разбирает падение: crash-report (если есть) + хвост лога → человеческий диагноз. null, если признаков краша нет. */
export async function diagnoseCrash(modpack: Modpack, gameRoot: string, logTail: string, spawnedAt: number): Promise<Diagnosis | null> {
  const report = findCrashReport(gameRoot, spawnedAt)
  const text = `${report?.text ?? ''}\n${logTail ?? ''}`
  const evidence = !!report || /Exception|Error|Incompatible|requires|failed|Mixin|OutOfMemory/i.test(logTail ?? '')
  if (!evidence) return null

  const base = { reportPath: report?.path, copyText: (report?.text ?? logTail ?? '').slice(-8000) }

  // 1. Память
  if (/OutOfMemoryError|GC overhead limit exceeded/.test(text)) {
    return {
      category: 'memory',
      title: 'Не хватило оперативной памяти',
      detail: 'Игре не хватило выделенной памяти (ОЗУ). Увеличьте выделение памяти в настройках лаунчера.',
      fixes: [{ kind: 'increase-ram', label: 'Увеличить память' }],
      ...base
    }
  }

  // 2. Java
  if (/UnsupportedClassVersionError/.test(text)) {
    return {
      category: 'java',
      title: 'Несовместимая версия Java',
      detail: 'Один из модов собран под более новую Java, чем используется. Обычно решается обновлением мода или версии загрузчика.',
      culprit: suspectFromStack(text),
      ...base
    }
  }

  // 3. Зависимости — неверная версия (Fabric)
  let m = text.match(/Mod '(.+?)' \(.+?\).*?requires version (.+?) (?:or later )?of (?:mod )?['"]?(.+?)['"]?(?: \(.+?\))?, but only (.+?) is present/i)
  if (m) {
    const [, mod, need, dep, have] = m
    return {
      category: 'dependency',
      title: `Нужна другая версия: ${dep}`,
      detail: `Мод «${mod}» требует ${dep} версии ${need}, а установлена ${have}. Нужно поставить подходящую версию.`,
      culprit: mod,
      fixes: [{ kind: 'install-dep', label: `Установить ${dep} ${need}`, query: dep, version: need }],
      ...base
    }
  }

  // 3b. Зависимости — мод отсутствует (Fabric)
  m = text.match(/requires (?:any version|version .+?) of (?:mod )?['"]?(.+?)['"]?(?: \(.+?\))?,? which is missing/i)
  if (m) {
    return {
      category: 'dependency',
      title: `Не хватает зависимости: ${m[1]}`,
      detail: `Одному из модов нужен «${m[1]}», но его нет в сборке. Его надо установить.`,
      fixes: [{ kind: 'install-dep', label: `Установить ${m[1]}`, query: m[1] }],
      ...base
    }
  }

  // 3c. Зависимости (Forge/NeoForge)
  m = text.match(/Mod (?:ID )?['"]?(.+?)['"]? requires ['"]?(.+?)['"]?.*?(?:but it is missing|is not installed|which is missing)/i)
  if (m) {
    return {
      category: 'dependency',
      title: `Не хватает зависимости: ${m[2]}`,
      detail: `Мод «${m[1]}» требует «${m[2]}», которого нет в сборке. Его надо установить.`,
      culprit: m[1],
      fixes: [{ kind: 'install-dep', label: `Установить ${m[2]}`, query: m[2] }],
      ...base
    }
  }

  const ctx = makeCtx(modpack, gameRoot, report?.text ?? '', logTail ?? '', spawnedAt)

  // 4. Mixin - мод не смог встроиться в код игры или другого мода. Верим стеку падения; строке об ошибке
  //    применения в выводе игры - только когда стека нет (с ней игра могла и продолжить работу).
  const looseMixin = (): MixinFailure | null =>
    (/Mixin apply for mod .+? failed|Mixin apply failed .+?\.mixins\.json/i.test(text) ? parseMixinFailure(text) : null)
  const mixin = ctx.trace ? parseMixinFailure(ctx.trace) : looseMixin()
  if (mixin) {
    const d = await diagnoseMixin(ctx, mixin).catch(() => null)
    if (d) return { ...d, ...base }
  }

  // 5. Стек падения указывает на конкретный мод (в т.ч. «мод не нашёл код другого мода»)
  const traced = await diagnoseFromTrace(ctx).catch(() => null)
  if (traced) return { ...traced, ...base }

  // 5a. Стек виновника не назвал - тогда годится и строка про mixin из вывода
  const lateMixin = ctx.trace ? looseMixin() : null
  if (lateMixin) {
    const d = await diagnoseMixin(ctx, lateMixin).catch(() => null)
    if (d) return { ...d, ...base }
  }

  // 5b. Несовпадение версий (NoSuchMethod/NoClassDefFound) - виновника определить не удалось
  if (/NoSuchMethodError|NoClassDefFoundError|NoSuchFieldError/.test(text)) {
    const c = suspectFromStack(text)
    return {
      category: 'conflict',
      title: 'Несовпадение версий модов',
      detail: `Мод обращается к коду, которого нет - обычно он собран под другую версию игры или зависимости.${c ? ` Вероятный виновник: ${c}.` : ''}`,
      culprit: c,
      ...base
    }
  }

  // 6. Общее — виновник из стека
  const c = suspectFromStack(text)
  if (c) {
    return {
      category: 'mod-bug',
      title: 'Ошибка в моде',
      detail: `Игра упала из-за ошибки в моде. Вероятный виновник: ${c}. Откройте crash-report для подробностей.`,
      culprit: c,
      ...base
    }
  }

  // 7. Не распознали
  return {
    category: 'unknown',
    title: 'Игра вылетела',
    detail: 'Не удалось точно определить причину. Откройте crash-report или вкладку «Логи».',
    ...base
  }
}
