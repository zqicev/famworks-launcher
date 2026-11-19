import yauzl from 'yauzl'
import { createWriteStream, promises as fsp } from 'fs'
import { dirname, resolve, sep } from 'path'
import type { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { TextDecoder } from 'util'

// Потоковое чтение ZIP (yauzl): в память читается только оглавление, содержимое записей — потоком
// прямо в файл. (new AdmZip(path) читает ВЕСЬ архив в память, а getData() ещё и распаковывает запись
// целиком — на копии мира в 1 ГБ это гигабайты ОЗУ в main-процессе.)

export interface ZipItem {
  name: string        // путь внутри архива, всегда через '/'
  isDir: boolean
  size: number        // распакованный размер
  entry: yauzl.Entry
}

export interface ZipReader {
  items: ZipItem[]
  get(name: string): ZipItem | undefined
  /** Содержимое небольшой записи в память (служебные json и т.п.). */
  readBuffer(item: ZipItem, maxBytes?: number): Promise<Buffer>
  /** Текст записи по имени или null, если записи нет/не читается. */
  readText(name: string, maxBytes?: number): Promise<string | null>
  /** Распаковывает запись в файл dest потоком (папки создаёт). */
  extractTo(item: ZipItem, dest: string): Promise<void>
  close(): void
}

const DEFAULT_MAX = 64 * 1024 * 1024
const utf8Strict = new TextDecoder('utf-8', { fatal: true })

/** Имя записи: UTF-8 по флагу или если байты валидны как UTF-8 (adm-zip/наши архивы/mrpack);
 *  иначе — архив из «Проводника» на русской Windows (CP866), в крайнем случае latin1. */
function decodeName(raw: Buffer | string, flags: number): string {
  if (typeof raw === 'string') return raw.replace(/\\/g, '/')
  let s: string
  if (flags & 0x800) s = raw.toString('utf8')
  else {
    try { s = utf8Strict.decode(raw) } catch {
      try { s = new TextDecoder('ibm866').decode(raw) } catch { s = raw.toString('latin1') }
    }
  }
  return s.replace(/\\/g, '/')
}

export function openZipReader(path: string): Promise<ZipReader> {
  return new Promise((resolveOpen, rejectOpen) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: false }, (err, zip) => {
      if (err || !zip) return rejectOpen(err ?? new Error('Не удалось открыть архив'))
      const items: ZipItem[] = []
      const byName = new Map<string, ZipItem>()
      let listed = false

      // Слушатель ошибок держим всё время: без него поздняя ошибка yauzl уронила бы main-процесс.
      zip.on('error', (e: Error) => {
        if (listed) return
        try { zip.close() } catch { /* уже закрыт */ }
        rejectOpen(e)
      })
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = decodeName(entry.fileName as unknown as Buffer | string, entry.generalPurposeBitFlag)
        const item: ZipItem = { name, isDir: name.endsWith('/'), size: entry.uncompressedSize, entry }
        items.push(item)
        if (!byName.has(name)) byName.set(name, item)
        zip.readEntry()
      })
      zip.on('end', () => {
        listed = true
        const openStream = (item: ZipItem): Promise<Readable> => new Promise((res, rej) => {
          zip.openReadStream(item.entry, (e2, stream) => (e2 || !stream ? rej(e2 ?? new Error('Не удалось прочитать запись')) : res(stream)))
        })
        const readBuffer = async (item: ZipItem, maxBytes = DEFAULT_MAX): Promise<Buffer> => {
          if (item.size > maxBytes) throw new Error(`Запись ${item.name} слишком большая`)
          const stream = await openStream(item)
          const chunks: Buffer[] = []
          let len = 0
          for await (const c of stream) {
            const buf = c as Buffer
            len += buf.length
            if (len > maxBytes) { stream.destroy(); throw new Error(`Запись ${item.name} слишком большая`) }
            chunks.push(buf)
          }
          return Buffer.concat(chunks, len)
        }
        resolveOpen({
          items,
          get: (name) => byName.get(name),
          readBuffer,
          readText: async (name, maxBytes) => {
            const item = byName.get(name)
            if (!item || item.isDir) return null
            try { return (await readBuffer(item, maxBytes)).toString('utf8') } catch { return null }
          },
          extractTo: async (item, dest) => {
            if (item.isDir) { await fsp.mkdir(dest, { recursive: true }); return }
            await fsp.mkdir(dirname(dest), { recursive: true })
            await pipeline(await openStream(item), createWriteStream(dest))
          },
          close: () => { try { zip.close() } catch { /* уже закрыт */ } }
        })
      })
      zip.readEntry()
    })
  })
}

/** Путь внутри root для имени из архива или null (zip-slip: «../», абсолютные пути, диск C: и т.п.). */
export function safeTarget(root: string, rel: string): string | null {
  if (!rel || rel.includes('\0') || /^[a-zA-Z]:/.test(rel)) return null
  const base = resolve(root)
  const dest = resolve(base, rel.replace(/^\/+/, ''))
  return dest === base || dest.startsWith(base + sep) ? dest : null
}

/** Распаковывает весь архив в destRoot потоково (с защитой от zip-slip). filter — какие записи брать. */
export async function extractAll(zipPath: string, destRoot: string, opts: {
  filter?: (name: string) => boolean
  overwrite?: boolean
} = {}): Promise<void> {
  const zip = await openZipReader(zipPath)
  try {
    for (const it of zip.items) {
      if (opts.filter && !opts.filter(it.name)) continue
      const dest = safeTarget(destRoot, it.name)
      if (!dest) continue
      if (!it.isDir && opts.overwrite === false) {
        try { await fsp.access(dest); continue } catch { /* файла нет — распаковываем */ }
      }
      await zip.extractTo(it, dest)
    }
  } finally {
    zip.close()
  }
}
