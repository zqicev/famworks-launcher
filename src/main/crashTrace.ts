import { join } from 'path'
import { readdirSync } from 'fs'
import AdmZip from 'adm-zip'
import { matchModFile } from './modFiles'

// Разбор краш-трейса и сопоставление его с jar-файлами модов сборки:
// какой мод упал (по имени jar в строке стека или по классу) и чей код он не нашёл.

export interface Frame {
  cls: string
  jar?: string
  mixinMod?: string // кадр - код, встроенный (mixin) в этот класс модом с таким id
}

export interface ModJar {
  file: string
  id?: string
  name: string          // из fabric.mod.json, иначе имя файла
  version?: string
  classes: Set<string>  // пути .class внутри jar
  dirs: Set<string>     // все каталоги (пакеты), в которых есть классы
  configs: Set<string>  // json-файлы, среди которых mixin-конфиги (foo.mixins.json)
}

// «at knot/com.foo.Bar.baz(Bar.java:12) ~[SomeMod-1.0.jar:?]» - префикс модуля и jar необязательны
const FRAME_RE = /^\s+at\s+(?:[\w.@-]+\/+)?([\w$.]+)\.([\w$<>-]+)\(.*?\)(?:\s+~?\[([^\]]*?\.jar)[^\]]*\])?/
// Метод, который Mixin встроил в чужой класс, несёт id мода-автора: handler$dmh000$shine$injectBloomOutput,
// redirect$clh000$iris$…, wrapOperation$blo000$fabric-screen-api-v1$…, лямбды - md69b3b0$modid$lambda$…
const MIXIN_METHOD_RE = /^(?:[A-Za-z]+\$[a-z]{3}\d{3}|md[0-9a-f]{6})\$([a-z0-9_.-]+)\$/
const TRACE_LINE_RE = /^\s+at\s|^\s*Caused by: |^\s+\.\.\. \d+ |^\s*Suppressed: /

// Признаки настоящего падения, по убыванию надёжности. Без якоря стек не трогаем: в обычном логе
// полно безобидных исключений (моды логируют их и работают дальше) - винить по ним нельзя.
const ANCHORS = [
  '---- Minecraft Crash Report ----',
  'Minecraft has crashed!',
  'Reported exception thrown!',
  'Unreported exception thrown!',
  'Failed to start Minecraft',
  'Encountered an unexpected exception',
  'Exception in thread "main"',
  'Exception in thread "Render thread"'
]

/** Вырезает стек упавшего исключения (заголовок + кадры + Caused by). '' - явного падения в тексте нет. */
export function extractCrashTrace(src: string): string {
  for (const anchor of ANCHORS) {
    const idx = src.lastIndexOf(anchor)
    if (idx < 0) continue
    const lines = src.slice(idx).split(/\r?\n/)
    const first = lines.slice(0, 40).findIndex(l => FRAME_RE.test(l))
    if (first < 1) continue
    const out = [lines[first - 1]]
    for (let i = first; i < lines.length && TRACE_LINE_RE.test(lines[i]); i++) out.push(lines[i])
    return out.join('\n')
  }
  return ''
}

export const LINKAGE_RE = /(ClassNotFoundException|NoClassDefFoundError|NoSuchMethodError|NoSuchFieldError|AbstractMethodError|IncompatibleClassChangeError)$/

export interface ParsedTrace {
  type: string        // класс корневого исключения
  message: string
  rootFrames: Frame[] // кадры корневой причины (последний Caused by)
  frames: Frame[]     // все кадры
}

export function parseTrace(trace: string): ParsedTrace {
  const lines = trace.split('\n')
  let rootIdx = 0
  lines.forEach((l, i) => { if (/^\s*Caused by: /.test(l)) rootIdx = i })
  const header = lines[rootIdx].replace(/^\s*Caused by: /, '')

  // Заголовок бывает цепочкой «A: B: C: сообщение» - берём первую ошибку связывания, иначе последнее исключение.
  let type = ''
  let message = header
  const re = /([\w.$]+(?:Exception|Error))(?::\s*|$)/g
  for (let m = re.exec(header); m; m = re.exec(header)) {
    type = m[1]
    message = header.slice(m.index + m[0].length)
    if (LINKAGE_RE.test(type)) break
  }

  const toFrames = (ls: string[]): Frame[] =>
    ls.map(l => FRAME_RE.exec(l)).filter((m): m is RegExpExecArray => !!m)
      .map(m => ({ cls: m[1], jar: m[3], mixinMod: MIXIN_METHOD_RE.exec(m[2])?.[1] }))
  return { type, message, rootFrames: toFrames(lines.slice(rootIdx + 1)), frames: toFrames(lines) }
}

/** Какой класс не нашёлся - из сообщения ошибки связывания. */
export function missingClass(type: string, message: string): string | null {
  const msg = message.trim()
  let cls: string | undefined
  if (/ClassNotFoundException$|NoClassDefFoundError$/.test(type)) {
    cls = /^(?:Could not initialize class )?([\w$./]+)/.exec(msg)?.[1]
  } else if (/NoSuchFieldError$/.test(type)) {
    cls = /Class ([\w$.]+) does not have/.exec(msg)?.[1]
  } else {
    // 'void net.foo.Bar.baz(int)' или net.foo.Bar.baz(I)V
    cls = /([\w$./]+)\.[\w$<>]+\(/.exec(msg)?.[1]
  }
  cls = cls?.replace(/\//g, '.')
  return cls && cls.includes('.') ? cls : null
}

/** id / имя / версия мода из fabric.mod.json или quilt.mod.json. */
function readMeta(zip: AdmZip): { id?: string; name?: string; version?: string } {
  try {
    const fabric = zip.getEntry('fabric.mod.json')
    if (fabric) {
      const j = JSON.parse(fabric.getData().toString('utf8'))
      return { id: j.id, name: j.name, version: j.version }
    }
    const quilt = zip.getEntry('quilt.mod.json')
    if (quilt) {
      const q = JSON.parse(quilt.getData().toString('utf8')).quilt_loader
      return { id: q?.id, name: q?.metadata?.name, version: q?.version }
    }
  } catch { /* кривой json - остаётся имя файла */ }
  return {}
}

function readModJar(modsDir: string, file: string): ModJar | null {
  try {
    const zip = new AdmZip(join(modsDir, file))
    const classes = new Set<string>()
    const dirs = new Set<string>()
    const configs = new Set<string>()
    for (const e of zip.getEntries()) {
      const n = e.entryName
      if (n.endsWith('.class')) {
        classes.add(n)
        for (let d = n.slice(0, Math.max(0, n.lastIndexOf('/'))); d && !dirs.has(d); d = d.slice(0, Math.max(0, d.lastIndexOf('/')))) dirs.add(d)
      } else if (n.endsWith('.json') && (!n.includes('/') || /mixin/i.test(n))) {
        configs.add(n)
      }
    }
    const meta = readMeta(zip)
    return { file, id: meta.id, name: meta.name || file.replace(/\.jar$/i, ''), version: meta.version, classes, dirs, configs }
  } catch {
    return null
  }
}

/** Читает оглавления всех включённых jar в mods. Между файлами отдаёт управление, чтобы не подвешивать окно. */
export async function scanMods(modsDir: string): Promise<ModJar[]> {
  let files: string[]
  try { files = readdirSync(modsDir).filter(f => f.toLowerCase().endsWith('.jar')) } catch { return [] }
  const out: ModJar[] = []
  for (const f of files) {
    const jar = readModJar(modsDir, f)
    if (jar) out.push(jar)
    await new Promise(r => setImmediate(r))
  }
  return out
}

/** Реально загруженные моды из шапки лога Fabric/Quilt («Loading N mods:»): id → версия. */
export function loadedMods(log: string): Map<string, string> {
  const out = new Map<string, string>()
  const start = log.search(/Loading \d+ mods:/)
  if (start < 0) return out
  for (const line of log.slice(start).split(/\r?\n/).slice(1)) {
    const m = /^\s+- (\S+) (\S+)\s*$/.exec(line)
    if (m) out.set(m[1], m[2])
    else if (!/^\s+[|\\]/.test(line)) break // не вложенная зависимость - список кончился
  }
  return out
}

/**
 * Моды, которые загрузчик реально использует: из нескольких версий одного мода он берёт одну.
 * Какую - видно по шапке лога (loaded); если её нет, считаем как сам Fabric - новейшую.
 */
export function activeMods(all: ModJar[], loaded: Map<string, string>): ModJar[] {
  const newest = new Map<string, ModJar>()
  for (const j of all) {
    if (!j.id || !j.version) continue
    const cur = newest.get(j.id)
    if (!cur || j.version.localeCompare(cur.version ?? '', undefined, { numeric: true }) > 0) newest.set(j.id, j)
  }
  return all.filter(j => {
    if (!j.id || !j.version) return true
    const v = loaded.get(j.id)
    return v !== undefined ? v === j.version : newest.get(j.id) === j
  })
}

/** Мод, в чьём jar лежит этот класс. */
export function ownerOfClass(cls: string, jars: ModJar[]): ModJar | undefined {
  const path = cls.replace(/\./g, '/') + '.class'
  return jars.find(j => j.classes.has(path))
}

/** Первый кадр стека, принадлежащий моду из папки mods. */
export function modOfFrames(frames: Frame[], jars: ModJar[]): ModJar | undefined {
  for (const f of frames) {
    if (f.mixinMod) {
      // Встроенный код принадлежит автору вставки, а не владельцу класса. Автора нет среди файлов
      // (вложенный мод вроде модулей Fabric API) - кадр пропускаем.
      const author = jars.find(j => j.id === f.mixinMod)
      if (author) return author
      continue
    }
    const byFile = f.jar ? jars.find(j => j.file.toLowerCase() === f.jar!.toLowerCase()) : undefined
    if (byFile) return byFile
    if (f.jar) continue // jar известен, но это не мод из папки (библиотека, загрузчик, вложенный jar)
    const byClass = ownerOfClass(f.cls, jars)
    if (byClass) return byClass
  }
  return undefined
}

export interface MixinFailure {
  modId?: string   // чей mixin не применился
  config?: string  // его mixin-конфиг (foo.mixins.json)
  target?: string  // класс, в который он встраивался
}

const MIXIN_FAIL_RE = /MixinApplyError|InvalidMixinException|InvalidInjectionException|MixinTransformerError|Mixin apply for mod |Mixin apply failed |Mixin transformation of /

/** Мод не смог встроиться (mixin) в чужой класс: кто и куда - из текста ошибки Mixin. null - ошибка не про mixin. */
export function parseMixinFailure(text: string): MixinFailure | null {
  if (!MIXIN_FAIL_RE.test(text)) return null
  const modId = (/Mixin apply for mod ([\w.-]+) failed/.exec(text) ?? /from mod ([\w.-]+)/.exec(text))?.[1]
  const config = (/([\w.\-/]+\.json):[\w.$]+ from mod/.exec(text) ?? /Mixin apply failed ([\w.\-/]+\.json)/.exec(text))?.[1]
  const target = (
    /-> ([\w.$]+):/.exec(text) ?? /target class ([\w.$/]+)/.exec(text)
    ?? /targets matching '[^']*' in ([\w.$/]+)/.exec(text) ?? /Mixin transformation of ([\w.$]+) failed/.exec(text)
  )?.[1]
  const trim = (v?: string): string | undefined => v?.replace(/\//g, '.').replace(/\.+$/, '') || undefined
  return { modId: modId?.replace(/\.+$/, '') || undefined, config, target: trim(target) }
}

/** Мод из папки mods: по id, по имени его mixin-конфига, а без метаданных (Forge) - по имени файла. */
export function modOfMixin(f: MixinFailure, jars: ModJar[]): ModJar | undefined {
  const byName = (): ModJar | undefined => {
    const file = f.modId ? matchModFile(jars.map(j => j.file), f.modId) : undefined
    return file ? jars.find(j => j.file === file) : undefined
  }
  return (f.modId ? jars.find(j => j.id === f.modId) : undefined)
    ?? (f.config ? jars.find(j => j.configs.has(f.config!)) : undefined)
    ?? byName()
}

/** Мод, которому принадлежит пакет класса (самое глубокое совпадение, минимум 3 сегмента). */
export function ownerByPackage(cls: string, jars: ModJar[]): ModJar | undefined {
  const parts = cls.split('.').slice(0, -1)
  for (let n = parts.length; n >= 3; n--) {
    const dir = parts.slice(0, n).join('/')
    const hit = jars.find(j => j.dirs.has(dir))
    if (hit) return hit
  }
  return undefined
}
