import { join } from 'path'
import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { Modpack } from '../types/modpack'

export type CrashCategory = 'dependency' | 'conflict' | 'memory' | 'java' | 'mod-bug' | 'unknown'

// Дескриптор возможной починки (исполнение — Фаза 2)
export type CrashFix =
  | { kind: 'install-dep'; label: string; query: string; version?: string }
  | { kind: 'increase-ram'; label: string }
  | { kind: 'disable-mod'; label: string; mod: string }

export interface Diagnosis {
  category: CrashCategory
  title: string
  detail: string
  culprit?: string
  reportPath?: string
  copyText: string
  fix?: CrashFix
}

// Пакеты ванилы/загрузчиков/библиотек — не считаем их виновником
const VANILLA_PKG = /^(net\.minecraft|com\.mojang|java|javax|jdk|sun|net\.fabricmc|org\.quiltmc|org\.spongepowered|cpw\.mods|net\.neoforged|net\.minecraftforge|io\.netty|org\.lwjgl|oshi|com\.google|it\.unimi|org\.apache|org\.slf4j|joptsimple)\b/

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

/** Разбирает падение: crash-report (если есть) + хвост лога → человеческий диагноз. null, если признаков краша нет. */
export function diagnoseCrash(modpack: Modpack, gameRoot: string, logTail: string, spawnedAt: number): Diagnosis | null {
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
      fix: { kind: 'increase-ram', label: 'Увеличить память' },
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
      fix: { kind: 'install-dep', label: `Установить ${dep} ${need}`, query: dep, version: need },
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
      fix: { kind: 'install-dep', label: `Установить ${m[1]}`, query: m[1] },
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
      fix: { kind: 'install-dep', label: `Установить ${m[2]}`, query: m[2] },
      ...base
    }
  }

  // 4. Mixin — конфликт/несовместимость
  m = text.match(/Mixin apply for mod (.+?) failed/i) || text.match(/Mixin apply failed (.+?\.mixins\.json)/i)
  if (m) {
    const mod = m[1].replace(/\.mixins\.json$/i, '')
    return {
      category: 'conflict',
      title: 'Конфликт мода (mixin)',
      detail: `Мод «${mod}» не смог применить свои изменения - обычно это несовместимость с версией игры или с другим модом. Попробуйте обновить или отключить его.`,
      culprit: mod,
      fix: { kind: 'disable-mod', label: `Отключить ${mod}`, mod },
      ...base
    }
  }

  // 5. Несовпадение версий (NoSuchMethod/NoClassDefFound)
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
